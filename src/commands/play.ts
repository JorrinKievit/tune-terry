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
        .addSubcommand((command) => command.setName("skip").setDescription("Skip the current song"))
        .addSubcommand((command) => command.setName("stop").setDescription("Stop the music"))
        .addSubcommand((command) => command.setName("list").setDescription("List the current queue")),
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

      this.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      if (this.queue.length === 0) {
        await this.addQueue(url);
      }
      this.player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });
      this.playCurrentSong();

      this.player.on(AudioPlayerStatus.Idle, () => {
        this.queue.shift();
        if (this.queue.length > 0) {
          this.playCurrentSong();
        } else {
          this.connection?.disconnect();
        }
      });
      this.connection.subscribe(this.player);

      this.connection.on(VoiceConnectionStatus.Destroyed, () => {
        this.queue = [];
      });
      this.connection.on(VoiceConnectionStatus.Disconnected, () => {
        this.queue = [];
      });

      return await interaction.reply({ content: `Added ${this.queue.length} songs to the queue!`, ephemeral: true });
    } catch {
      return interaction.reply({ content: "Something went wrong!", ephemeral: true });
    }
  }

  public async skip(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    try {
      if (this.queue.length === 0) {
        return await interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
      }
      this.queue.shift();
      this.playCurrentSong();
      return await interaction.reply({ content: "Skipped the current song!", ephemeral: true });
    } catch {
      return interaction.reply({ content: "Something went wrong!", ephemeral: true });
    }
  }

  public async stop(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    try {
      if (this.queue.length === 0) {
        return await interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
      }
      this.queue = [];
      this.connection?.disconnect();
      return await interaction.reply({ content: "Stopped the music!", ephemeral: true });
    } catch {
      return interaction.reply({ content: "Something went wrong!", ephemeral: true });
    }
  }

  public async list(interaction: Subcommand.ChatInputCommandInteraction): Promise<InteractionResponse<boolean>> {
    try {
      if (this.queue.length === 0) {
        return await interaction.reply({ content: "There are no songs in the queue!", ephemeral: true });
      }
      const queue = this.queue.map((song, index) => `${index + 1}. ${song.title}`).join("\n");
      return await interaction.reply({ content: queue, ephemeral: true });
    } catch {
      return interaction.reply({ content: "Something went wrong!", ephemeral: true });
    }
  }

  private addQueue = async (url: string): Promise<void> => {
    try {
      const info = await playlist_info(url);
      const videos = await info.all_videos();
      for (const video of videos) {
        this.queue.push({ url: video.url, title: video.title });
      }
    } catch {
      try {
        const info = await video_info(url);
        this.queue.push({ url: info.video_details.url, title: info.video_details.title });
      } catch {
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
