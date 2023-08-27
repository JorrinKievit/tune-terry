import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { send } from "@sapphire/plugin-editable-commands";
import { ApplicationCommandType, Message } from "discord.js";

@ApplyOptions<Command.Options>({
  name: "ping",
  description: "Ping the bot!",
})
export class UserCommand extends Command {
  // Register slash and context menu command
  public override registerApplicationCommands(registry: Command.Registry): void {
    // Register slash command
    registry.registerChatInputCommand({
      name: this.name,
      description: this.description,
    });

    // Register context menu command available from any message
    registry.registerContextMenuCommand({
      name: this.name,
      type: ApplicationCommandType.Message,
    });

    // Register context menu command available from any user
    registry.registerContextMenuCommand({
      name: this.name,
      type: ApplicationCommandType.User,
    });
  }

  public async messageRun(message: Message): Promise<Message<boolean>> {
    const returnMessage = await send(message, "Ping?");

    const content = `Pong! Bot Latency ${Math.round(this.container.client.ws.ping)}ms. API Latency ${
      (returnMessage.editedTimestamp || returnMessage.createdTimestamp) - (message.editedTimestamp || message.createdTimestamp)
    }ms.`;

    return send(message, content);
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<Message<boolean>> {
    const message = await interaction.reply({ content: "Ping?", fetchReply: true });

    const content = `Pong! Bot Latency ${Math.round(this.container.client.ws.ping)}ms. API Latency ${
      message.createdTimestamp - interaction.createdTimestamp
    }ms.`;

    return interaction.editReply({
      content,
    });
  }

  public async contextMenuRun(interaction: Command.ContextMenuCommandInteraction): Promise<Message<boolean>> {
    const message = await interaction.reply({ content: "Ping?", fetchReply: true });

    const content = `Pong! Bot Latency ${Math.round(this.container.client.ws.ping)}ms. API Latency ${
      message.createdTimestamp - interaction.createdTimestamp
    }ms.`;

    return interaction.editReply({
      content,
    });
  }
}
