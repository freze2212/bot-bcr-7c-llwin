import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type TemplateVariables = Record<string, string>;
export type AccountStatus = 'active' | 'disabled';

export interface LoginCredential {
  key: string;
  pin?: string;
  accountName: string;
  balance: number;
  status?: AccountStatus;
}

export type LoginAccount = TemplateVariables & {
  key: string;
  accountName: string;
  balance: string;
};

export interface AccountSummary extends LoginAccount {
  pin: string;
  status: string;
}

export interface ListButtonGroups {
  table: string[][];
  cai: string[][];
  con: string[][];
}

interface ResultCheck {
  inputPattern: string;
  outcomes: string[];
  message: string[];
  buttons?: {
    checkAnotherResult?: string;
  };
  insufficientBalanceMessage: string[];
}

interface AdminContent {
  panelMessage: string[];
  buttons: Record<string, string>;
  messages: Record<string, string[]>;
}

interface BotContent {
  fallbackTelegramName: string;
  start: {
    message: string[];
    buttons: {
      acceptTerms: string;
      declineTerms: string;
    };
  };
  acceptTerms: {
    message: string[];
    buttons: {
      login: string;
      contactAdmin: string;
    };
  };
  declineTerms: {
    message: string[];
  };
  login: {
    message: string[];
    successMessage: string[];
    invalidMessage: string[];
    buttons: {
      contactAdmin: string;
      choosePreviousResult?: string;
    };
    listButton: string[][] | ListButtonGroups;
    mockCredentials?: LoginCredential[];
  };
  contactAdmin: {
    message: string[];
    url: string;
  };
  resultCheck: ResultCheck;
  admin: AdminContent;
}

@Injectable()
export class BotService {
  private readonly content: BotContent;

  constructor(private readonly configService: ConfigService) {
    const contentPath = resolve(
      process.cwd(),
      this.configService.get<string>('BOT_CONFIG_PATH') ??
        this.configService.get<string>('BOT_CONTENT_PATH') ??
        'data/config.data.json',
    );

    this.content = JSON.parse(readFileSync(contentPath, 'utf8')) as BotContent;
  }

  get fallbackTelegramName(): string {
    return this.content.fallbackTelegramName;
  }

  startMessage(): string {
    return this.renderLines(this.content.start.message);
  }

  startButtons() {
    return this.content.start.buttons;
  }

  acceptTermsMessage(variables: TemplateVariables): string {
    return this.renderLines(this.content.acceptTerms.message, variables);
  }

  acceptTermsButtons() {
    return this.content.acceptTerms.buttons;
  }

  declineTermsMessage(): string {
    return this.renderLines(this.content.declineTerms.message);
  }

  loginMessage(): string {
    return this.renderLines(this.content.login.message);
  }

  loginSuccessMessage(account: LoginAccount): string {
    return this.renderLines(this.content.login.successMessage, account);
  }

  loginInvalidMessage(): string {
    return this.renderLines(this.content.login.invalidMessage);
  }

  loginButtons() {
    return this.content.login.buttons;
  }

  selectionPromptMessage(
    _account: LoginAccount,
    selectedTableDraft?: {
      table?: { tableName: string };
      cai?: { tableName: string };
      con?: { tableName: string };
    },
    stepTitle?: string,
    warning?: string,
    _currentStep?: 'table' | 'con' | 'cai',
  ): string {
    const lines: string[] = [
      `✨ ${stepTitle ?? 'Vui lòng chọn kết quả ván trước'}`,
      '━━━━━━━━━━━━━━━━━━━━',
    ];

    if (selectedTableDraft?.table?.tableName) {
      lines.push(`📍 Bàn: ${selectedTableDraft.table.tableName}`);
    }

    if (selectedTableDraft?.con?.tableName) {
      lines.push(`🔵 Con: ${selectedTableDraft.con.tableName}`);
    }

    if (selectedTableDraft?.cai?.tableName) {
      lines.push(`🔴 Cái: ${selectedTableDraft.cai.tableName}`);
    }

    if (warning) {
      lines.push(warning);
    }

    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('💡 Nếu muốn đổi bàn, vui lòng gõ /b');

    return lines.join('\n');
  }

  listButton(): ListButtonGroups {
    const listButton = this.content.login.listButton;

    if (!Array.isArray(listButton)) {
      return listButton;
    }

    const isTableRow = (row: string[]) =>
      row.some((button) => {
        const normalizedButton = button.trim().toUpperCase();

        return (
          normalizedButton.startsWith('BÀN') || /^C\d+$/.test(normalizedButton)
        );
      });

    return {
      table: listButton.filter(isTableRow),
      cai: listButton.filter((row) => !isTableRow(row)),
      con: listButton.filter((row) => !isTableRow(row)),
    };
  }

  contactAdminMessage(): string {
    return this.renderLines(this.content.contactAdmin.message);
  }

  contactAdminUrl(): string {
    return this.content.contactAdmin.url;
  }

  isResultCheckInput(input: string): boolean {
    return new RegExp(this.content.resultCheck.inputPattern, 'i').test(
      input.trim(),
    );
  }

  randomResult(): string {
    const outcomes = this.content.resultCheck.outcomes;
    const index = Math.floor(Math.random() * outcomes.length);

    return outcomes[index];
  }

  resultCheckMessage(result: string, balance: number): string {
    return this.renderLines(this.content.resultCheck.message, {
      result,
      balance: String(balance),
    });
  }

  resultCheckButtons() {
    return this.content.resultCheck.buttons ?? {};
  }

  insufficientBalanceMessage(): string {
    return this.renderLines(
      this.content.resultCheck.insufficientBalanceMessage,
    );
  }

  isBotOwner(userId: number | undefined): boolean {
    return Boolean(userId && this.botAdminIds().includes(String(userId)));
  }

  botOwnerId(): string | undefined {
    return this.botAdminIds()[0];
  }

  botAdminIds(): string[] {
    return [
      this.configService.get<string>('BOT_OWNER_ID'),
      this.configService.get<string>('BOT_ADMIN_ID'),
    ].flatMap((configuredAdminIds) =>
      this.parseConfiguredTelegramUserIds(configuredAdminIds),
    );
  }

  adminPanelMessage(): string {
    return this.renderLines(this.content.admin.panelMessage);
  }

  adminButtons() {
    return this.content.admin.buttons;
  }

  adminMessage(name: string, variables: TemplateVariables = {}): string {
    return this.renderLines(
      this.content.admin.messages[name],
      this.withPinDisplay(variables),
    );
  }

  loginCredentials(): LoginCredential[] {
    return this.content.login.mockCredentials ?? [];
  }

  private renderLines(
    lines: string[],
    variables: TemplateVariables = {},
  ): string {
    return lines
      .map((line) => ({
        line,
        renderedLine: this.renderTemplate(line, variables),
      }))
      .filter(({ line, renderedLine }) => {
        return line !== '{pinLine}' || renderedLine.length > 0;
      })
      .map(({ renderedLine }) => renderedLine)
      .join('\n');
  }

  private renderTemplate(line: string, variables: TemplateVariables): string {
    return line.replace(/\{(\w+)}/g, (placeholder, key: string) => {
      return variables[key] ?? placeholder;
    });
  }

  private withPinDisplay(variables: TemplateVariables): TemplateVariables {
    const pin = variables.pin;

    if (!pin || pin.toUpperCase() === 'SKIP') {
      return {
        ...variables,
        pinInline: '',
        pinLine: '',
      };
    }

    return {
      ...variables,
      pinInline: ` | PIN: ${pin}`,
      pinLine: `🔐 PIN: ${pin}`,
    };
  }

  private parseConfiguredTelegramUserIds(
    configuredUserIds: string | undefined,
  ): string[] {
    return (
      configuredUserIds
        ?.split(/[,\s]+/)
        .map((userId) =>
          userId
            .trim()
            .replace(/^['"]|['"]$/g, '')
            .trim(),
        )
        .filter(Boolean) ?? []
    );
  }
}
