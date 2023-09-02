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
import { container } from "@sapphire/framework";
import { Subcommand } from "@sapphire/plugin-subcommands";
import { InteractionResponse } from "discord.js";
import { playlist_info, stream, video_info } from "play-dl";

interface MusicQueue {
  url: string;
  title?: string;
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
            .setDescription("Play a song or playlist using a YouTube URL")
            .addStringOption((option) => option.setName("url").setDescription("The URL to play").setRequired(true)),
        )
        .addSubcommand((command) =>
          command
            .setName("skip")
            .setDescription("Skip the current song")
            .addNumberOption((option) => option.setName("number").setDescription("The song to skip to in the queue")),
        )
        .addSubcommand((command) => command.setName("stop").setDescription("Stop the music"))
        .addSubcommand((command) => command.setName("list").setDescription("List the current queue"))
        .addSubcommand((command) => command.setName("current").setDescription("Get the current song")),
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

      const addedSongs = await this.addQueue(url);

      if (!this.player) {
        this.player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play,
          },
        });
      }
      if (this.player.state.status !== AudioPlayerStatus.Playing) {
        this.playCurrentSong();
      }

      this.player.on(AudioPlayerStatus.Idle, () => {
        this.queue.shift();
        if (this.queue.length > 0) {
          this.playCurrentSong();
        } else {
          this.connection?.disconnect();
          this.connection?.destroy();
          this.connection = null;
        }
      });
      this.connection.subscribe(this.player);

      this.connection.on(VoiceConnectionStatus.Destroyed, () => {
        this.queue = [];
        this.connection?.disconnect();
        this.connection?.destroy();
        this.connection = null;
      });
      this.connection.on(VoiceConnectionStatus.Disconnected, () => {
        this.queue = [];
        this.connection?.disconnect();
        this.connection?.destroy();
        this.connection = null;
      });

      return await interaction.reply({
        content: `Added ${addedSongs.length} song${addedSongs.length > 1 ? "s" : ""} to the queue!`,
      });
    } catch (error) {
      this.container.logger.fatal(error);
      return interaction.reply({ content: "Something went wrong!", ephemeral: true });
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
      return interaction.reply({ content: "Something went wrong!", ephemeral: true });
    }
  }

  public async stop(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    try {
      if (this.queue.length === 0) {
        return await interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
      }
      this.queue = [];
      this.connection?.destroy();
      this.connection = null;
      return await interaction.reply({ content: "Stopped the music!" });
    } catch (error) {
      this.container.logger.fatal(error);
      return interaction.reply({ content: "Something went wrong!", ephemeral: true });
    }
  }

  public async list(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    try {
      if (this.queue.length === 0) {
        return await interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
      }
      const queue = this.queue.map((song, index) => `${index + 1}. ${song.title}`).join("\n");
      return await interaction.reply({ content: queue });
    } catch (error) {
      this.container.logger.fatal(error);
      return interaction.reply({ content: "Something went wrong!", ephemeral: true });
    }
  }

  public async current(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    if (this.queue.length === 0) {
      return interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
    }
    return interaction.reply({ content: this.queue[0].title });
  }

  private addQueue = async (url: string): Promise<MusicQueue[]> => {
    const songs: MusicQueue[] = [];
    try {
      const info = await playlist_info(url);
      const videos = await info.all_videos();
      for (const video of videos) {
        songs.push({ url: video.url, title: video.title });
        this.queue.push({ url: video.url, title: video.title });
      }
      return songs;
    } catch (error) {
      this.container.logger.fatal(error);

      try {
        const info = await video_info(url);
        songs.push({ url: info.video_details.url, title: info.video_details.title });
        this.queue.push({ url: info.video_details.url, title: info.video_details.title });
        return songs;
      } catch (error_) {
        this.container.logger.fatal(error_);
        throw new Error("Invalid URL!");
      }
    }
  };

  private playCurrentSong = async (): Promise<void> => {
    const playStream = await stream(this.queue[0].url);
    const resource = createAudioResource(playStream.stream, { inputType: playStream.type });
    this.player?.play(resource);
  };
}
