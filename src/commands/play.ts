import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { ApplyOptions } from "@sapphire/decorators";
import { Subcommand } from "@sapphire/plugin-subcommands";
import { InteractionResponse } from "discord.js";
import {
  is_expired,
  playlist_info,
  refreshToken,
  search,
  setToken,
  spotify,
  SpotifyAlbum,
  SpotifyPlaylist,
  SpotifyTrack,
  stream,
  validate,
  video_info,
} from "play-dl";

import { formatError } from "../utils/error";

setToken({
  spotify: {
    client_id: process.env.SPOTIFY_CLIENT_ID,
    client_secret: process.env.SPOTIFY_CLIENT_SECRET,
    refresh_token: process.env.SPOTIFY_REFRESH_TOKEN,
    market: "US",
  },
});

interface MusicQueue {
  url: string;
  title?: string;
  type: "youtube" | "spotify";
}

@ApplyOptions<Subcommand.Options>({
  name: "music",
  description: "Manage your music queue!",
  subcommands: [
    {
      name: "play",
      type: "method",
      chatInputRun: "play",
    },
    {
      name: "skip",
      type: "method",
      chatInputRun: "skip",
    },
    {
      name: "stop",
      type: "method",
      chatInputRun: "stop",
    },
    {
      name: "list",
      type: "method",
      chatInputRun: "list",
    },
    {
      name: "current",
      type: "method",
      chatInputRun: "current",
    },
    {
      name: "shuffle",
      type: "method",
      chatInputRun: "shuffle",
    },
  ],
})
export class UserCommand extends Subcommand {
  private queue: MusicQueue[] = [];

  private connection: VoiceConnection | null = null;

  private player: AudioPlayer | null = null;

  public override registerApplicationCommands(registry: Subcommand.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand((command) =>
          command
            .setName("play")
            .setDescription("Play a song or playlist using a YouTube or Spotify URL")
            .addStringOption((option) => option.setName("url").setDescription("The URL to play").setRequired(true)),
        )
        .addSubcommand((command) =>
          command
            .setName("skip")
            .setDescription("Skip the current song")
            .addNumberOption((option) => option.setName("number").setDescription("The song to skip to in the queue")),
        )
        .addSubcommand((command) => command.setName("stop").setDescription("Stop the music"))
        .addSubcommand((command) =>
          command
            .setName("list")
            .setDescription("List the current queue")
            .addNumberOption((option) => option.setName("page").setDescription("The page to view (30 songs per page)").setMinValue(1)),
        )
        .addSubcommand((command) => command.setName("current").setDescription("Get the current song"))
        .addSubcommand((command) => command.setName("shuffle").setDescription("Shuffle the queue")),
    );
  }

  public async play(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    try {
      const url = interaction.options.getString("url", true);
      const member = interaction.guild?.members.cache.get(interaction.user.id);
      const voiceChannel = member?.voice.channel;

      if (!voiceChannel || !interaction.guildId || !interaction.guild) {
        return await interaction.reply({ content: "You must be in a voice channel to use this command!", ephemeral: true });
      }

      if (!voiceChannel.joinable) {
        return await interaction.reply({ content: "I don't have permission to join that voice channel!", ephemeral: true });
      }

      if (!this.connection) {
        this.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });
      }

      if (is_expired()) {
        await refreshToken();
      }

      const addedSongs = await this.addQueue(url);

      if (!this.player) {
        this.player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play,
          },
        });
        if (this.player.state.status !== AudioPlayerStatus.Playing) {
          this.playCurrentSong();
        }

        // this.player.on(AudioPlayerStatus.Idle, () => {
        //   this.queue.shift();
        //   if (this.queue.length > 0) {
        //     this.playCurrentSong();
        //   } else {
        //     this.closeConnection();
        //   }
        // });
      }

      this.connection.subscribe(this.player);

      this.connection.on(VoiceConnectionStatus.Destroyed, () => {
        this.queue = [];
      });

      this.connection.on(VoiceConnectionStatus.Disconnected, () => {
        this.queue = [];
        this.closeConnection();
      });

      return await interaction.reply({
        content: `Added ${addedSongs.length} song${addedSongs.length > 1 ? "s" : ""} to the queue!`,
      });
    } catch (error) {
      this.container.logger.fatal(error);
      return interaction.reply({ content: formatError(error), ephemeral: true });
    }
  }

  public async skip(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    try {
      if (this.queue.length === 0) {
        return await interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
      }
      const number = interaction.options.getNumber("number");
      let skippedSong: MusicQueue;

      if (number) {
        if (number > this.queue.length) {
          return await interaction.reply({ content: "That song doesn't exist in the queue!", ephemeral: true });
        }
        skippedSong = this.queue[number - 2];
        this.queue = this.queue.slice(number - 1);
      } else {
        skippedSong = this.queue[0];
        this.queue = this.queue.slice(1);
      }
      this.playCurrentSong();
      return await interaction.reply({ content: `Skipped ${skippedSong.title}` });
    } catch (error) {
      this.container.logger.fatal(error);
      return interaction.reply({ content: formatError(error), ephemeral: true });
    }
  }

  public async stop(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    try {
      if (this.queue.length === 0) {
        return await interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
      }
      this.queue = [];
      this.closeConnection();
      return await interaction.reply({ content: "Stopped the music!" });
    } catch (error) {
      this.container.logger.fatal(error);
      return interaction.reply({ content: formatError(error), ephemeral: true });
    }
  }

  public async list(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    const page = interaction.options.getNumber("page") ?? 1;

    try {
      if (this.queue.length === 0) {
        return await interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
      }

      const queue = this.queue
        .map((song, index) => `${index + 1}. ${song.title}`)
        .slice((page - 1) * 30, page * 30)
        .join("\n")
        .slice(0, 2000);

      return await interaction.reply({ content: queue });
    } catch (error) {
      this.container.logger.fatal(error);
      return interaction.reply({ content: formatError(error), ephemeral: true });
    }
  }

  public async current(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    if (this.queue.length === 0) {
      return interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
    }
    return interaction.reply({ content: this.queue[0].title });
  }

  public async shuffle(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    try {
      if (this.queue.length === 0) {
        return await interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
      }
      this.queue = [this.queue[0], ...this.queue.slice(1).sort(() => Math.random() - 0.5)];
      return await interaction.reply({ content: "Shuffled the queue!" });
    } catch (error) {
      this.container.logger.fatal(error);
      return interaction.reply({ content: formatError(error), ephemeral: true });
    }
  }

  private addQueue = async (url: string): Promise<MusicQueue[]> => {
    const songs: MusicQueue[] = [];

    const validatedUrl = await validate(url);
    if (validatedUrl === "sp_track" || validatedUrl === "sp_album" || validatedUrl === "sp_playlist") {
      const spData = await spotify(url);
      if (validatedUrl === "sp_track") {
        if (spData.name) {
          const searched = await search(
            `${(spData as SpotifyTrack).artists?.map((artist) => artist.name).join(", ")} | ${(spData as SpotifyTrack).name} lyrics`,
            {
              limit: 1,
            },
          );
          songs.push({ url: searched[0].url, title: searched[0].title, type: "youtube" });
          this.queue.push({ url: searched[0].url, title: searched[0].title, type: "youtube" });
        } else {
          throw new Error("No video found for the supplied Spotify URL");
        }
      }

      if (validatedUrl === "sp_album" || validatedUrl === "sp_playlist") {
        const allTracks = await (spData as SpotifyPlaylist | SpotifyAlbum).all_tracks();
        for (const track of allTracks) {
          if (!track.name) continue;
          songs.push({
            url: track.url,
            title: `${track.artists?.map((artist) => artist.name).join(", ")} | ${track.name} lyrics`,
            type: "spotify",
          });
          this.queue.push({
            url: track.url,
            title: `${track.artists?.map((artist) => artist.name).join(", ")} | ${track.name} lyrics`,
            type: "spotify",
          });
        }
      }

      return songs;
    }

    if (validatedUrl === "yt_playlist") {
      try {
        const info = await playlist_info(url, {
          incomplete: true,
        });
        const videos = await info.all_videos();
        for (const video of videos) {
          if (!video.title) continue;
          songs.push({ url: video.url, title: video.title, type: "youtube" });
          this.queue.push({ url: video.url, title: video.title, type: "youtube" });
        }
        return songs;
      } catch (error) {
        throw new Error(formatError(error));
      }
    }

    if (validatedUrl === "yt_video") {
      try {
        const info = await video_info(url);
        songs.push({ url: info.video_details.url, title: info.video_details.title, type: "youtube" });
        this.queue.push({ url: info.video_details.url, title: info.video_details.title, type: "youtube" });
        return songs;
      } catch (error) {
        throw new Error(formatError(error));
      }
    }

    throw new Error("Invalid URL!");
  };

  private playCurrentSong = async (): Promise<void> => {
    if (this.queue[0].type === "spotify") {
      const searched = await search(`${this.queue[0].title}`, {
        limit: 1,
      });
      this.queue[0].url = searched[0].url;
    }
    const playStream = await stream(this.queue[0].url);
    const resource = createAudioResource(playStream.stream, { inputType: playStream.type });
    this.player?.play(resource);
  };

  private closeConnection = (): void => {
    this.connection?.destroy();
    this.player?.stop();
    this.player = null;
    this.connection = null;
  };
}
