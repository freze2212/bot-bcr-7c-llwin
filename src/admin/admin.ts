import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context, Markup, Telegraf } from 'telegraf';
import {
  Action,
  Command,
  Ctx,
  Hears,
  InjectBot,
  Update,
} from 'nestjs-telegraf';
import { AccountService } from '../account/account.service';
import { BotService } from '../bot/bot.service';
import {
  AdminAction,
  AdminState,
  clearAdminState,
  getAdminState,
  hasAdminState,
  setAdminState,
} from './admin-state.store';

@Update()
export class Admin implements OnModuleInit {
  private readonly logger = new Logger(Admin.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly configService: ConfigService,
    private readonly botContent: BotService,
    private readonly accountService: AccountService,
  ) {}

  async onModuleInit() {
    if (this.configService.get<string>('NODE_ENV') === 'test') {
      return;
    }

    await this.registerBotCommands();
  }

  @Command('admin')
  async admin(@Ctx() ctx: Context) {
    this.logger.log(`Admin command received ${this.getActorLog(ctx)}`);

    if (!(await this.ensureBotOwner(ctx))) {
      return;
    }

    await ctx.reply(
      this.botContent.adminPanelMessage(),
      Markup.inlineKeyboard(this.getAdminPanelKeyboard()),
    );
  }

  @Action(/^admin:(.+)$/)
  async adminAction(@Ctx() ctx: Context) {
    const callbackData = this.getCallbackData(ctx);

    this.logger.log(
      `Admin callback received action=${callbackData || 'unknown'} ${this.getActorLog(ctx)}`,
    );

    if (!(await this.ensureBotOwner(ctx))) {
      return;
    }

    await this.answerCallbackQuery(ctx);

    const action = callbackData.replace('admin:', '');

    if (action === 'back') {
      this.logger.log(`Admin flow back ${this.getActorLog(ctx)}`);
      clearAdminState(ctx);
      await ctx.reply(
        this.botContent.adminPanelMessage(),
        Markup.inlineKeyboard(this.getAdminPanelKeyboard()),
      );
      return;
    }

    if (action === 'cancel') {
      this.logger.log(`Admin flow cancelled ${this.getActorLog(ctx)}`);
      clearAdminState(ctx);
      await ctx.reply(
        this.botContent.adminMessage('cancelled'),
        Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
      );
      return;
    }

    if (action === 'list_accounts') {
      this.logger.log(`Admin account list requested ${this.getActorLog(ctx)}`);
      await ctx.reply(
        this.getAccountListMessage(),
        Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
      );
      return;
    }

    await this.startAdminFlow(ctx, action as AdminAction);
  }

  @Hears((value, ctx) => (hasAdminState(ctx) ? /[\s\S]*/.exec(value) : null))
  async handleAdminText(@Ctx() ctx: Context) {
    if (!hasAdminState(ctx)) {
      return;
    }

    if (!(await this.ensureBotOwner(ctx))) {
      return;
    }

    const text = this.getMessageText(ctx);
    const state = getAdminState(ctx);

    this.logger.log(
      `Admin text received action=${state?.action ?? 'unknown'} step=${state?.step ?? 'unknown'} ${this.getActorLog(ctx)}`,
    );

    if (!text) {
      return;
    }

    await this.handleAdminInput(ctx, text);
  }

  private async ensureBotOwner(ctx: Context): Promise<boolean> {
    if (this.botContent.isBotOwner(ctx.from?.id)) {
      this.logger.log(`Admin access granted ${this.getActorLog(ctx)}`);
      return true;
    }

    this.logger.warn(`Admin access denied ${this.getActorLog(ctx)}`);
    await this.answerCallbackQuery(ctx);
    await ctx.reply(this.botContent.adminMessage('forbidden'));
    return false;
  }

  private async answerCallbackQuery(ctx: Context): Promise<void> {
    await ctx.answerCbQuery().catch((error: unknown) => {
      this.logger.debug(
        `Ignored expired callback query ${this.getActorLog(ctx)} error=${this.getErrorMessage(error)}`,
      );
    });
  }

  private async registerBotCommands() {
    try {
      const adminIds = this.botContent.botAdminIds();

      await this.bot.telegram.setMyCommands(
        [{ command: 'start', description: 'Bắt đầu dùng bot' }],
        { scope: { type: 'default' } },
      );

      if (adminIds.length === 0) {
        this.logger.warn(
          'BOT_OWNER_ID or BOT_ADMIN_ID is not configured; /admin menu not set',
        );
        return;
      }

      await Promise.all(
        adminIds.map(async (adminId) => {
          await this.bot.telegram
            .setMyCommands(
              [
                { command: 'start', description: 'Bắt đầu dùng bot' },
                { command: 'admin', description: 'Mở admin panel' },
              ],
              { scope: { type: 'chat', chat_id: adminId } },
            )
            .catch((error: unknown) => {
              this.logger.warn(
                `Admin command menu was not registered for chatId=${adminId} error=${this.getErrorMessage(error)}`,
              );
            });
        }),
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to set bot commands: ${this.getErrorMessage(error)}`,
      );
    }
    this.logger.log(`Bot commands registered with admin menu`);
  }

  private getAdminPanelKeyboard() {
    const buttons = this.botContent.adminButtons();

    return [
      [
        Markup.button.callback(buttons.createAccount, 'admin:create_account'),
        Markup.button.callback(buttons.deleteAccount, 'admin:delete_account'),
      ],
      [
        Markup.button.callback(buttons.addBalance, 'admin:add_balance'),
        Markup.button.callback(
          buttons.subtractBalance,
          'admin:subtract_balance',
        ),
      ],
      [Markup.button.callback(buttons.checkAccount, 'admin:check_account')],
      [Markup.button.callback(buttons.listAccounts, 'admin:list_accounts')],
    ];
  }

  private getAdminFooterKeyboard() {
    const buttons = this.botContent.adminButtons();

    return [
      [
        Markup.button.callback(buttons.back, 'admin:back'),
        Markup.button.callback(buttons.cancel, 'admin:cancel'),
      ],
    ];
  }

  private async startAdminFlow(ctx: Context, action: AdminAction) {
    const userId = ctx.from?.id;

    if (!userId) {
      return;
    }

    setAdminState(userId, {
      action,
      step: 'key',
      payload: {},
    });

    this.logger.log(
      `Admin flow started action=${action} ${this.getActorLog(ctx)}`,
    );

    await ctx.reply(
      this.botContent.adminMessage(
        action === 'create_account' ? 'enterNewKey' : 'enterKey',
      ),
      Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
    );
  }

  private async handleAdminInput(ctx: Context, text: string) {
    const state = getAdminState(ctx);

    if (!state) {
      return;
    }

    if (state.step === 'key') {
      await this.handleAdminKeyStep(ctx, state, text.trim());
      return;
    }

    if (state.step === 'pin') {
      const pinNormalized = text.trim().toUpperCase().replace(/^\//, '');
      state.payload.pin = pinNormalized === 'SKIP' ? undefined : text.trim();
      state.step = 'balance';
      await ctx.reply(
        this.botContent.adminMessage('enterBalance'),
        Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
      );
      return;
    }

    if (state.step === 'balance') {
      await this.createAdminAccount(ctx, state, text);
      return;
    }

    if (state.step === 'amount') {
      await this.updateAdminBalance(ctx, state, text);
    }
  }

  private async handleAdminKeyStep(
    ctx: Context,
    state: AdminState,
    key: string,
  ) {
    state.payload.key = key;
    this.logger.log(
      `Admin key step action=${state.action} ${this.getActorLog(ctx)}`,
    );

    if (state.action === 'create_account') {
      if (this.accountService.findAccountSummary(key)) {
        await ctx.reply(
          this.botContent.adminMessage('accountExists'),
          Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
        );
        return;
      }

      state.step = 'pin';
      await ctx.reply(
        this.botContent.adminMessage('enterPin'),
        Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
      );
      return;
    }

    if (state.action === 'check_account') {
      const account = this.accountService.findAccountSummary(key);
      clearAdminState(ctx);
      this.logger.log(
        `Admin check account completed found=${Boolean(account)} ${this.getActorLog(ctx)}`,
      );

      await ctx.reply(
        account
          ? this.botContent.adminMessage('accountInfo', account)
          : this.botContent.adminMessage('accountNotFound'),
        Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
      );
      return;
    }

    if (state.action === 'delete_account') {
      const account = this.accountService.deleteAccount(key);
      clearAdminState(ctx);
      this.logger.log(
        `Admin delete account completed deleted=${Boolean(account)} ${this.getActorLog(ctx)}`,
      );

      await ctx.reply(
        account
          ? this.botContent.adminMessage('deleteSuccess', account)
          : this.botContent.adminMessage('accountNotFound'),
        Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
      );
      return;
    }

    if (
      state.action === 'disable_account' ||
      state.action === 'enable_account'
    ) {
      const account = this.accountService.setAccountStatus(
        key,
        state.action === 'disable_account' ? 'disabled' : 'active',
      );
      clearAdminState(ctx);
      this.logger.log(
        `Admin status update completed action=${state.action} updated=${Boolean(account)} ${this.getActorLog(ctx)}`,
      );

      await ctx.reply(
        account
          ? this.botContent.adminMessage('statusUpdated', account)
          : this.botContent.adminMessage('accountNotFound'),
        Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
      );
      return;
    }

    state.step = 'amount';
    await ctx.reply(
      this.botContent.adminMessage('enterAmount'),
      Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
    );
  }

  private async createAdminAccount(
    ctx: Context,
    state: AdminState,
    text: string,
  ) {
    const balance = this.parsePositiveInteger(text);

    if (balance === undefined || !state.payload.key) {
      await ctx.reply(
        this.botContent.adminMessage('invalidAmount'),
        Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
      );
      return;
    }

    const account = this.accountService.createAccount({
      key: state.payload.key,
      pin: state.payload.pin,
      balance,
    });
    clearAdminState(ctx);
    this.logger.log(
      `Admin create account completed created=${Boolean(account)} balance=${balance} ${this.getActorLog(ctx)}`,
    );

    await ctx.reply(
      account
        ? this.botContent.adminMessage('createSuccess', account)
        : this.botContent.adminMessage('accountExists'),
      Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
    );
  }

  private async updateAdminBalance(
    ctx: Context,
    state: AdminState,
    text: string,
  ) {
    const amount = this.parsePositiveInteger(text);

    if (amount === undefined || !state.payload.key) {
      await ctx.reply(
        this.botContent.adminMessage('invalidAmount'),
        Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
      );
      return;
    }

    const account =
      state.action === 'add_balance'
        ? this.accountService.addBalance(state.payload.key, amount)
        : this.accountService.subtractBalance(state.payload.key, amount);

    clearAdminState(ctx);
    this.logger.log(
      `Admin balance update completed action=${state.action} updated=${Boolean(account)} amount=${amount} ${this.getActorLog(ctx)}`,
    );

    await ctx.reply(
      account
        ? this.botContent.adminMessage('balanceUpdated', account)
        : this.botContent.adminMessage('accountNotFound'),
      Markup.inlineKeyboard(this.getAdminFooterKeyboard()),
    );
  }

  private getAccountListMessage(): string {
    const accounts = this.accountService.listAccounts();

    if (accounts.length === 0) {
      return this.botContent.adminMessage('listEmpty');
    }

    return [
      this.botContent.adminMessage('listHeader'),
      ...accounts.map((account, index) =>
        this.botContent.adminMessage('listItem', {
          ...account,
          index: String(index + 1),
        }),
      ),
    ].join('\n');
  }

  private parsePositiveInteger(text: string): number | undefined {
    const value = Number(text.trim());

    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }

  private getMessageText(ctx: Context): string | undefined {
    const message = ctx.message;

    return message && 'text' in message ? message.text : undefined;
  }

  private getCallbackData(ctx: Context): string {
    const callbackQuery = ctx.callbackQuery;

    return callbackQuery && 'data' in callbackQuery ? callbackQuery.data : '';
  }

  private getActorLog(ctx: Context): string {
    const username = ctx.from?.username ? ` username=${ctx.from.username}` : '';

    return `userId=${ctx.from?.id ?? 'unknown'}${username}`;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
