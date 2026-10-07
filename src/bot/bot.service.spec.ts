import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { BotService } from './bot.service';

describe('BotService', () => {
  const originalBotContentPath = process.env.BOT_CONTENT_PATH;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bot-content-'));
    const contentPath = join(tempDir, 'content.json');

    writeFileSync(
      contentPath,
      JSON.stringify({
        fallbackTelegramName: 'guest',
        start: {
          message: ['start line 1', 'start line 2'],
          buttons: {
            acceptTerms: 'accept',
            declineTerms: 'decline',
          },
        },
        acceptTerms: {
          message: ['hello {telegramName}'],
          buttons: {
            login: 'login',
            contactAdmin: 'admin',
          },
        },
        declineTerms: {
          message: ['declined'],
        },
        login: {
          message: ['login message'],
          successMessage: ['success {accountName} {balance}'],
          invalidMessage: ['invalid message'],
          buttons: {
            contactAdmin: 'admin',
            choosePreviousResult: 'choose result',
          },
          listButton: {
            table: [['BÀN 1', 'BÀN 2', 'BÀN 3']],
            cai: [['0', '1', '2']],
            con: [['0', '1', '2']],
          },
          mockCredentials: [
            {
              key: 'KEY',
              accountName: 'demo_key',
              balance: 1000,
            },
            {
              key: 'KEY',
              pin: 'PIN',
              accountName: 'demo_key_pin',
              balance: 2000,
            },
          ],
        },
        contactAdmin: {
          message: ['admin message'],
          url: 'https://t.me/admin',
        },
        resultCheck: {
          inputPattern: '^/CON.*CAI.*$',
          outcomes: ['CON', 'CAI'],
          message: ['result {result} balance {balance}'],
          buttons: {
            checkAnotherResult: 'check again',
          },
          insufficientBalanceMessage: ['no balance'],
        },
        admin: {
          panelMessage: ['admin panel'],
          buttons: {
            createAccount: 'create',
            addBalance: 'add',
            subtractBalance: 'subtract',
            checkAccount: 'check',
            disableAccount: 'disable',
            enableAccount: 'enable',
            deleteAccount: 'delete',
            listAccounts: 'list',
            back: 'back',
            cancel: 'cancel',
          },
          messages: {
            forbidden: ['forbidden'],
            cancelled: ['cancelled'],
            enterKey: ['enter key'],
            enterNewKey: ['enter new key'],
            enterPin: ['enter pin'],
            enterBalance: ['enter balance'],
            enterAmount: ['enter amount'],
            invalidAmount: ['invalid amount'],
            accountExists: ['account exists'],
            accountNotFound: ['account not found'],
            createSuccess: ['created {key}', '{pinLine}', '{balance}'],
            balanceUpdated: ['updated {key} {balance}'],
            accountInfo: ['info {key}', '{pinLine}', '{balance} {status}'],
            statusUpdated: ['status {key} {status}'],
            deleteSuccess: ['deleted {key}'],
            listEmpty: ['empty'],
            listHeader: ['header'],
            listItem: ['{index} {key}{pinInline} {balance} {status}'],
          },
        },
      }),
    );

    process.env.BOT_CONTENT_PATH = contentPath;
  });

  afterEach(() => {
    if (originalBotContentPath === undefined) {
      delete process.env.BOT_CONTENT_PATH;
    } else {
      process.env.BOT_CONTENT_PATH = originalBotContentPath;
    }

    rmSync(tempDir, { force: true, recursive: true });
  });

  it('reads messages and renders template variables from config', () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'BOT_CONTENT_PATH' ? process.env.BOT_CONTENT_PATH : undefined,
      ),
    } as unknown as ConfigService;
    const service = new BotService(configService);

    expect(service.startMessage()).toBe('start line 1\nstart line 2');
    expect(service.acceptTermsMessage({ telegramName: 'Alice' })).toBe(
      'hello Alice',
    );
    expect(service.startButtons()).toEqual({
      acceptTerms: 'accept',
      declineTerms: 'decline',
    });
  });

  it('correctly categorizes table buttons including C15 to C22', () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'BOT_CONTENT_PATH' ? process.env.BOT_CONTENT_PATH : undefined,
      ),
    } as unknown as ConfigService;
    const service = new BotService(configService);

    const listButtons = service.listButton();
    expect(listButtons.table).toEqual([['BÀN 1', 'BÀN 2', 'BÀN 3']]);
  });

  it('renders login success messages from config', () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'BOT_CONTENT_PATH' ? process.env.BOT_CONTENT_PATH : undefined,
      ),
    } as unknown as ConfigService;
    const service = new BotService(configService);

    expect(
      service.loginSuccessMessage({
        accountName: 'demo_key',
        key: 'KEY',
        balance: '1000',
      }),
    ).toBe('success demo_key 1000');
    expect(
      service.selectionPromptMessage(
        {
          accountName: 'demo_key',
          key: 'KEY',
          balance: '1000',
        },
        {
          table: { tableName: 'BÀN 1' },
        },
        undefined,
        '⚠️ Bạn chưa chọn đủ field.',
      ),
    ).toBe(
      [
        '✨ Vui lòng chọn kết quả ván trước',
        '━━━━━━━━━━━━━━━━━━━━',
        '📍 Bàn: BÀN 1',
        '⚠️ Bạn chưa chọn đủ field.',
        '━━━━━━━━━━━━━━━━━━━━',
        '💡 Nếu muốn đổi bàn, vui lòng gõ /b',
      ].join('\n'),
    );
  });

  it('renders result check messages from config', () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'BOT_CONTENT_PATH' ? process.env.BOT_CONTENT_PATH : undefined,
      ),
    } as unknown as ConfigService;
    const service = new BotService(configService);

    expect(service.isResultCheckInput('/CON...CAI...')).toBe(true);
    expect(service.isResultCheckInput('/ABC')).toBe(false);
    expect(service.resultCheckMessage('CON', 999)).toBe(
      'result CON balance 999',
    );
    expect(service.resultCheckButtons()).toEqual({
      checkAnotherResult: 'check again',
    });
    expect(service.insufficientBalanceMessage()).toBe('no balance');
  });

  it('checks the configured bot owner and admin ids', () => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'BOT_CONTENT_PATH') {
          return process.env.BOT_CONTENT_PATH;
        }

        if (key === 'BOT_OWNER_ID') {
          return ' "123456" ';
        }

        if (key === 'BOT_ADMIN_ID') {
          return ' "654321", "777777" ';
        }

        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new BotService(configService);

    expect(service.isBotOwner(123456)).toBe(true);
    expect(service.isBotOwner(654321)).toBe(true);
    expect(service.isBotOwner(777777)).toBe(true);
    expect(service.isBotOwner(111111)).toBe(false);
    expect(service.isBotOwner(undefined)).toBe(false);
  });

  it('falls back to the legacy bot admin id config', () => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'BOT_CONTENT_PATH') {
          return process.env.BOT_CONTENT_PATH;
        }

        if (key === 'BOT_ADMIN_ID') {
          return ' "123456", "654321" ';
        }

        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new BotService(configService);

    expect(service.isBotOwner(123456)).toBe(true);
    expect(service.isBotOwner(654321)).toBe(true);
    expect(service.isBotOwner(111111)).toBe(false);
  });

  it('falls back to the legacy bot owner id config', () => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'BOT_CONTENT_PATH') {
          return process.env.BOT_CONTENT_PATH;
        }

        if (key === 'BOT_OWNER_ID') {
          return ' "123456" ';
        }

        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new BotService(configService);

    expect(service.isBotOwner(123456)).toBe(true);
    expect(service.isBotOwner(654321)).toBe(false);
  });

  it('hides admin pin display when the pin is SKIP', () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'BOT_CONTENT_PATH' ? process.env.BOT_CONTENT_PATH : undefined,
      ),
    } as unknown as ConfigService;
    const service = new BotService(configService);

    expect(
      service.adminMessage('accountInfo', {
        accountName: 'demo',
        balance: '1000',
        key: 'KEY',
        pin: 'PIN',
        status: 'active',
      }),
    ).toBe('info KEY\n🔐 PIN: PIN\n1000 active');

    expect(
      service.adminMessage('accountInfo', {
        accountName: 'demo',
        balance: '1000',
        key: 'KEY',
        pin: 'SKIP',
        status: 'active',
      }),
    ).toBe('info KEY\n1000 active');

    expect(
      service.adminMessage('listItem', {
        balance: '1000',
        index: '1',
        key: 'KEY',
        pin: 'SKIP',
        status: 'active',
      }),
    ).toBe('1 KEY 1000 active');
  });
});
