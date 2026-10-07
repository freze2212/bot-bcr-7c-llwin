import { ConfigService } from '@nestjs/config';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotService } from '../bot/bot.service';
import { AccountService } from './account.service';

describe('AccountService', () => {
  const originalBotContentPath = process.env.BOT_CONTENT_PATH;
  const originalAccountDataPath = process.env.ACCOUNT_DATA_PATH;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'account-content-'));
    const contentPath = join(tempDir, 'content.json');
    const accountDataPath = join(tempDir, 'accounts.json');

    writeFileSync(
      contentPath,
      JSON.stringify({
        fallbackTelegramName: 'guest',
        start: {
          message: ['start'],
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
            table: [['BÀN 1']],
            cai: [['0']],
            con: [['0']],
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
          buttons: {},
          messages: {},
        },
      }),
    );
    writeFileSync(
      accountDataPath,
      JSON.stringify([
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
      ]),
    );

    process.env.BOT_CONTENT_PATH = contentPath;
    process.env.ACCOUNT_DATA_PATH = accountDataPath;
  });

  afterEach(() => {
    if (originalBotContentPath === undefined) {
      delete process.env.BOT_CONTENT_PATH;
    } else {
      process.env.BOT_CONTENT_PATH = originalBotContentPath;
    }

    if (originalAccountDataPath === undefined) {
      delete process.env.ACCOUNT_DATA_PATH;
    } else {
      process.env.ACCOUNT_DATA_PATH = originalAccountDataPath;
    }

    rmSync(tempDir, { force: true, recursive: true });
  });

  it('finds login account data from account data file', () => {
    const service = createAccountService();

    expect(service.findLoginAccount('KEY')).toEqual({
      key: 'KEY',
      accountName: 'demo_key',
      balance: '1000',
    });
    expect(service.findLoginAccount('KEY PIN')).toEqual({
      key: 'KEY',
      accountName: 'demo_key_pin',
      balance: '2000',
    });
    expect(service.findLoginAccount('KEY WRONG')).toBeUndefined();
  });

  it('allows login with or without typing SKIP for accounts with SKIP or /SKIP pin', () => {
    const service = createAccountService();

    service.createAccount({
      key: 'NO_PIN_ACCOUNT',
      pin: '/SKIP',
      balance: 100,
    });

    expect(service.findLoginAccount('NO_PIN_ACCOUNT')).toEqual({
      key: 'NO_PIN_ACCOUNT',
      accountName: 'NO_PIN_ACCOUNT',
      balance: '100',
    });
    expect(service.findLoginAccount('NO_PIN_ACCOUNT SKIP')).toEqual({
      key: 'NO_PIN_ACCOUNT',
      accountName: 'NO_PIN_ACCOUNT',
      balance: '100',
    });
    expect(service.findLoginAccount('NO_PIN_ACCOUNT /SKIP')).toEqual({
      key: 'NO_PIN_ACCOUNT',
      accountName: 'NO_PIN_ACCOUNT',
      balance: '100',
    });
  });

  it('manages accounts for the admin panel', () => {
    const service = createAccountService();

    expect(
      service.createAccount({
        key: 'NEW',
        balance: 10,
      }),
    ).toEqual({
      key: 'NEW',
      pin: 'SKIP',
      accountName: 'NEW',
      balance: '10',
      status: 'active',
    });
    expect(service.addBalance('NEW', 5)?.balance).toBe('15');
    expect(service.subtractBalance('NEW', 3)?.balance).toBe('12');
    expect(service.debitAccount('NEW', 1)?.balance).toBe('11');
    expect(service.setAccountStatus('NEW', 'disabled')?.status).toBe(
      'disabled',
    );
    expect(service.findLoginAccount('NEW')).toBeUndefined();
    expect(service.deleteAccount('NEW')?.key).toBe('NEW');
    expect(service.findAccountSummary('NEW')).toBeUndefined();
  });

  it('persists admin account changes to the account data file', () => {
    const service = createAccountService();

    service.createAccount({
      key: 'SAVE_ME',
      pin: '1234',
      balance: 10,
    });
    service.addBalance('SAVE_ME', 5);

    const accounts = JSON.parse(
      readFileSync(process.env.ACCOUNT_DATA_PATH!, 'utf8'),
    ) as Array<{ key: string; pin?: string; balance: number }>;

    expect(accounts).toContainEqual(
      expect.objectContaining({
        key: 'SAVE_ME',
        pin: '1234',
        balance: 15,
      }),
    );
  });

  function createAccountService(): AccountService {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'BOT_CONTENT_PATH') {
          return process.env.BOT_CONTENT_PATH;
        }

        if (key === 'ACCOUNT_DATA_PATH') {
          return process.env.ACCOUNT_DATA_PATH;
        }

        return undefined;
      }),
    } as unknown as ConfigService;
    const botService = new BotService(configService);

    return new AccountService(botService, configService);
  }
});
