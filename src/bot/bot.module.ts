import { Context, Markup } from 'telegraf';
import { Action, Command, Ctx, Hears, Start, Update } from 'nestjs-telegraf';
import { AccountService } from '../account/account.service';
import { hasAdminState } from '../admin/admin-state.store';
import { BotService } from './bot.service';

interface UserSession {
  key: string;
  accountName: string;
}

interface SelectedTable {
  tableName: string;
}

interface SelectedTableDraft {
  table?: SelectedTable;
  cai?: SelectedTable;
  con?: SelectedTable;
}

type SelectionStep = 'table' | 'con' | 'cai';

@Update()
export class BotModule {
  private readonly waitingLoginUsers = new Set<number>();
  private readonly userSessions = new Map<number, UserSession>();
  private readonly selectedTables = new Map<number, SelectedTableDraft>();

  constructor(
    private readonly botContent: BotService,
    private readonly accountService: AccountService,
  ) {}

  @Start()
  async start(@Ctx() ctx: Context) {
    const buttons = this.botContent.startButtons();

    await ctx.reply(
      this.botContent.startMessage(),
      Markup.inlineKeyboard([
        [
          Markup.button.callback(buttons.acceptTerms, 'accept_terms'),
          Markup.button.callback(buttons.declineTerms, 'decline_terms'),
        ],
      ]),
    );
  }

  @Action('accept_terms')
  async acceptTerms(@Ctx() ctx: Context) {
    await this.answerCallbackQuery(ctx);

    const buttons = this.botContent.acceptTermsButtons();

    await ctx.reply(
      this.botContent.acceptTermsMessage({
        telegramName: this.getTelegramName(ctx),
      }),
      Markup.inlineKeyboard([
        [
          Markup.button.callback(buttons.login, 'login'),
          Markup.button.url(
            buttons.contactAdmin,
            this.botContent.contactAdminUrl(),
          ),
        ],
      ]),
    );
  }

  @Action('decline_terms')
  async declineTerms(@Ctx() ctx: Context) {
    await this.answerCallbackQuery(ctx);

    await ctx.reply(this.botContent.declineTermsMessage());
  }

  @Action('login')
  async login(@Ctx() ctx: Context) {
    await this.answerCallbackQuery(ctx);
    this.markWaitingLogin(ctx);
    await ctx.reply(this.botContent.loginMessage());
  }

  @Action('contact_admin')
  async contactAdmin(@Ctx() ctx: Context) {
    await this.answerCallbackQuery(ctx);
    await ctx.reply(this.botContent.contactAdminMessage());
  }

  @Command('b')
  @Command('ban')
  @Hears(/^\/b(?:àn|an)?(?:@\w+)?$/i)
  async handleSelectTableCommand(@Ctx() ctx: Context) {
    const session = this.getUserSession(ctx);

    if (!session) {
      await ctx.reply(this.botContent.loginMessage());
      return;
    }

    this.clearSelectedTable(ctx);
    await this.openTableSelection(ctx);
  }

  @Hears((value, ctx) => {
    if (hasAdminState(ctx)) {
      return null;
    }

    return /^(?:\/CON.*CAI.*|\/b(?:àn|an)?|[^/].*)$/i.exec(value);
  })
  async handleText(@Ctx() ctx: Context) {
    const text = this.getMessageText(ctx);

    if (!text) {
      return;
    }

    if (this.isWaitingLogin(ctx)) {
      await this.handleLoginInput(ctx, text);
      return;
    }

    const session = this.getUserSession(ctx);

    if (!session) {
      const account = this.accountService.findLoginAccount(text);

      if (account) {
        await this.handleLoginInput(ctx, text);
        return;
      }

      this.markWaitingLogin(ctx);
      await ctx.reply(this.botContent.loginMessage());
      return;
    }

    const normalizedText = text.trim();

    if (/^\/b(?:àn|an)?$/i.test(normalizedText)) {
      this.clearSelectedTable(ctx);
      await this.openTableSelection(ctx);
      return;
    }

    if (this.botContent.isResultCheckInput(text)) {
      const selectedTableDraft = this.getSelectedTableDraft(ctx);
      await this.handleResultCheck(ctx, selectedTableDraft);
      return;
    }

    const digitsMatch = normalizedText.match(/\d/g);

    if (digitsMatch) {
      const selectedTableDraft = this.getSelectedTableDraft(ctx);

      if (!selectedTableDraft?.table) {
        await ctx.reply(
          '⚠️ Vui lòng chọn bàn trước khi nhập số. (Gõ /b để chọn bàn)',
        );
        await this.openTableSelection(ctx);
        return;
      }

      if (digitsMatch.length >= 2) {
        const con = digitsMatch[0];
        const cai = digitsMatch[1];
        const updatedDraft: SelectedTableDraft = {
          table: selectedTableDraft.table,
          con: { tableName: con },
          cai: { tableName: cai },
        };

        const userId = ctx.from?.id;

        if (userId) {
          this.selectedTables.set(userId, updatedDraft);
        }

        await this.handleResultCheck(ctx, updatedDraft);
        return;
      }

      if (digitsMatch.length === 1) {
        const digit = digitsMatch[0];
        const currentStep = this.getCurrentSelectionStep(selectedTableDraft);

        if (currentStep === 'con') {
          const updatedDraft: SelectedTableDraft = {
            table: selectedTableDraft.table,
            con: { tableName: digit },
          };

          const userId = ctx.from?.id;

          if (userId) {
            this.selectedTables.set(userId, updatedDraft);
          }

          await this.updateSelectedTableDraftMessage(
            ctx,
            session.key,
            updatedDraft,
          );
          return;
        }

        if (currentStep === 'cai') {
          const updatedDraft: SelectedTableDraft = {
            table: selectedTableDraft.table,
            con: selectedTableDraft.con,
            cai: { tableName: digit },
          };

          const userId = ctx.from?.id;

          if (userId) {
            this.selectedTables.set(userId, updatedDraft);
          }

          await this.handleResultCheck(ctx, updatedDraft);
          return;
        }
      }
    }
  }

  private async handleLoginInput(ctx: Context, text: string) {
    const account = this.accountService.findLoginAccount(text);

    if (account) {
      this.clearWaitingLogin(ctx);
      this.saveUserSession(ctx, account);
      this.clearSelectedTable(ctx);

      await ctx.reply(this.botContent.loginSuccessMessage(account));
      await this.openTableSelection(ctx);
      return;
    }

    const buttons = this.botContent.loginButtons();

    await ctx.reply(
      this.botContent.loginInvalidMessage(),
      Markup.inlineKeyboard([
        [
          Markup.button.url(
            buttons.contactAdmin,
            this.botContent.contactAdminUrl(),
          ),
        ],
      ]),
    );
  }

  @Action('open_table_selection')
  async openTableSelection(@Ctx() ctx: Context) {
    await this.answerCallbackQuery(ctx);

    const session = this.getUserSession(ctx);

    if (!session) {
      await ctx.reply(this.botContent.loginMessage());
      return;
    }

    const account = this.accountService.findAccountSummary(session.key);

    if (!account) {
      await ctx.reply(this.botContent.loginInvalidMessage());
      return;
    }

    const selectedTableDraft = this.getSelectedTableDraft(ctx);
    const currentStep = this.getCurrentSelectionStep(selectedTableDraft);

    await ctx.reply(
      this.botContent.selectionPromptMessage(
        {
          key: account.key,
          accountName: account.accountName,
          balance: account.balance,
        },
        selectedTableDraft,
        this.getSelectionStepTitle(currentStep),
        undefined,
        currentStep,
      ),
      Markup.inlineKeyboard(
        this.getTableKeyboard(currentStep, selectedTableDraft),
      ),
    );
  }

  private async handleResultCheck(
    ctx: Context,
    selectedTableDraft: SelectedTableDraft | undefined,
  ) {
    const session = this.getUserSession(ctx);

    if (!session) {
      await ctx.reply(this.botContent.loginMessage());
      return;
    }

    const account = this.accountService.debitAccount(session.key, 1);

    if (!account) {
      await ctx.reply(this.botContent.insufficientBalanceMessage());
      return;
    }

    const result = this.botContent.randomResult();
    this.resetTurnSelection(ctx);
    const resultButtons = this.botContent.resultCheckButtons();

    await ctx.reply(
      [this.botContent.resultCheckMessage(result, Number(account.balance))]
        .filter(Boolean)
        .join('\n\n'),
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            resultButtons.checkAnotherResult ?? 'Kiểm tra',
            'open_table_selection',
          ),
        ],
      ]),
    );
  }

  @Action(/^select_table:(.+)$/)
  async selectTable(@Ctx() ctx: Context) {
    await this.answerCallbackQuery(ctx);

    const session = this.getUserSession(ctx);

    if (!session) {
      await ctx.reply(this.botContent.loginMessage());
      return;
    }

    const tableName = this.getCallbackData(ctx).replace('select_table:', '');
    const selectedTableDraft = this.getSelectedTableDraft(ctx);
    const currentStep = this.getCurrentSelectionStep(selectedTableDraft);

    if (!this.isTableOptionInCurrentStep(currentStep, tableName)) {
      await this.updateSelectedTableDraftMessage(
        ctx,
        session.key,
        selectedTableDraft,
        '⚠️ Lựa chọn không hợp lệ.',
      );
      return;
    }

    const nextSelectedTableDraft = this.saveSelectedTable(
      ctx,
      currentStep,
      tableName,
    );

    if (!nextSelectedTableDraft) {
      await this.updateSelectedTableDraftMessage(
        ctx,
        session.key,
        selectedTableDraft,
        '⚠️ Không thể lưu lựa chọn.',
      );
      return;
    }

    await this.updateSelectedTableDraftMessage(
      ctx,
      session.key,
      nextSelectedTableDraft,
    );
  }

  @Action('submit_table_result')
  async submitTableResult(@Ctx() ctx: Context) {
    await this.answerCallbackQuery(ctx);

    const session = this.getUserSession(ctx);

    if (!session) {
      await ctx.reply(this.botContent.loginMessage());
      return;
    }

    const selectedTableDraft = this.getSelectedTableDraft(ctx);

    if (!this.isSelectedTableDraftComplete(selectedTableDraft)) {
      await this.updateSelectedTableDraftMessage(
        ctx,
        session.key,
        selectedTableDraft,
        '⚠️ Bạn chưa chọn đủ field.',
      );
      return;
    }

    await this.handleResultCheck(ctx, selectedTableDraft);
  }

  private async answerCallbackQuery(ctx: Context): Promise<void> {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery().catch(() => undefined);
    }
  }

  private getTelegramName(ctx: Context): string {
    const from = ctx.from;

    if (!from) {
      return this.botContent.fallbackTelegramName;
    }

    return (
      from.first_name || from.username || this.botContent.fallbackTelegramName
    );
  }

  private markWaitingLogin(ctx: Context): void {
    const userId = ctx.from?.id;

    if (userId) {
      this.waitingLoginUsers.add(userId);
    }
  }

  private isWaitingLogin(ctx: Context): boolean {
    const userId = ctx.from?.id;

    return Boolean(userId && this.waitingLoginUsers.has(userId));
  }

  private clearWaitingLogin(ctx: Context): void {
    const userId = ctx.from?.id;

    if (userId) {
      this.waitingLoginUsers.delete(userId);
    }
  }

  private saveUserSession(
    ctx: Context,
    account: { key: string; accountName: string },
  ): void {
    const userId = ctx.from?.id;

    if (userId) {
      this.userSessions.set(userId, {
        key: account.key,
        accountName: account.accountName,
      });
    }
  }

  private getUserSession(ctx: Context): UserSession | undefined {
    const userId = ctx.from?.id;

    return userId ? this.userSessions.get(userId) : undefined;
  }

  private saveSelectedTable(
    ctx: Context,
    step: SelectionStep,
    tableName: string,
  ): SelectedTableDraft | undefined {
    const userId = ctx.from?.id;

    if (!userId) {
      return undefined;
    }

    const selectedTableDraft = this.selectedTables.get(userId) ?? {};
    const nextSelectedTableDraft = {
      ...selectedTableDraft,
      [step]: { tableName },
    };

    this.selectedTables.set(userId, nextSelectedTableDraft);

    return nextSelectedTableDraft;
  }

  private getSelectedTableDraft(ctx: Context): SelectedTableDraft | undefined {
    const userId = ctx.from?.id;

    return userId ? this.selectedTables.get(userId) : undefined;
  }

  private clearSelectedTable(ctx: Context): void {
    const userId = ctx.from?.id;

    if (userId) {
      this.selectedTables.delete(userId);
    }
  }

  private resetTurnSelection(ctx: Context): void {
    const userId = ctx.from?.id;

    if (!userId) {
      return;
    }

    const current = this.selectedTables.get(userId);

    if (current?.table) {
      this.selectedTables.set(userId, { table: current.table });
    } else {
      this.selectedTables.delete(userId);
    }
  }

  private getMessageText(ctx: Context): string | undefined {
    const message = ctx.message;

    return message && 'text' in message ? message.text : undefined;
  }

  private getCallbackData(ctx: Context): string {
    const callbackQuery = ctx.callbackQuery;

    return callbackQuery && 'data' in callbackQuery ? callbackQuery.data : '';
  }

  private getTableKeyboard(
    step: SelectionStep,
    selectedTableDraft?: SelectedTableDraft,
  ) {
    const listButton = this.botContent.listButton();
    const rowsByStep: Record<SelectionStep, string[][]> = {
      table: listButton.table,
      cai: listButton.cai,
      con: listButton.con,
    };
    const rows = rowsByStep[step].map((row) =>
      row.map((tableName) =>
        Markup.button.callback(tableName, `select_table:${tableName}`),
      ),
    );

    if (selectedTableDraft?.table && selectedTableDraft.cai && selectedTableDraft.con) {
      rows.push([Markup.button.callback('Kiểm tra', 'submit_table_result')]);
    }

    return rows;
  }

  private isSelectedTableDraftComplete(
    selectedTableDraft: SelectedTableDraft | undefined,
  ): selectedTableDraft is Required<SelectedTableDraft> {
    return Boolean(
      selectedTableDraft?.table && selectedTableDraft.cai && selectedTableDraft.con,
    );
  }

  private async updateSelectedTableDraftMessage(
    ctx: Context,
    accountKey: string,
    selectedTableDraft: SelectedTableDraft | undefined,
    warning?: string,
  ): Promise<void> {
    const account = this.accountService.findAccountSummary(accountKey);

    if (!account) {
      await ctx.reply(this.botContent.loginInvalidMessage());
      return;
    }

    const currentStep = this.getCurrentSelectionStep(selectedTableDraft);
    const keyboard = Markup.inlineKeyboard(
      this.getTableKeyboard(currentStep, selectedTableDraft),
    );
    const message = this.botContent.selectionPromptMessage(
      {
        key: account.key,
        accountName: account.accountName,
        balance: account.balance,
      },
      selectedTableDraft,
      this.getSelectionStepTitle(currentStep),
      warning,
      currentStep,
    );

    await ctx.editMessageText(message, keyboard).catch(async () => {
      await ctx.reply(message, keyboard);
    });
  }

  private getCurrentSelectionStep(
    selectedTableDraft?: SelectedTableDraft,
  ): SelectionStep {
    if (!selectedTableDraft?.table) {
      return 'table';
    }

    if (!selectedTableDraft.con) {
      return 'con';
    }

    return 'cai';
  }

  private getSelectionStepTitle(step: SelectionStep): string {
    if (step === 'table') {
      return 'Chọn bàn';
    }

    return step === 'con' ? 'Chọn Con' : 'Chọn Cái';
  }

  private isTableOptionInCurrentStep(
    step: SelectionStep,
    tableName: string,
  ): boolean {
    const listButton = this.botContent.listButton();

    return listButton[step].some((row) => row.includes(tableName));
  }
}
