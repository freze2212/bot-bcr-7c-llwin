import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  AccountStatus,
  AccountSummary,
  LoginAccount,
  LoginCredential,
} from '../bot/bot.service';
import { BotService } from '../bot/bot.service';

@Injectable()
export class AccountService {
  private readonly accounts: LoginCredential[];
  private readonly accountDataPath: string;

  constructor(
    private readonly botContent: BotService,
    private readonly configService: ConfigService,
  ) {
    this.accountDataPath = resolve(
      process.cwd(),
      this.configService.get<string>('ACCOUNT_DATA_PATH') ??
        'data/account.data.json',
    );
    this.accounts = this.loadAccounts().map((credential) => ({
      ...credential,
      status: credential.status ?? 'active',
    }));
  }

  findLoginAccount(input: string): LoginAccount | undefined {
    const parts = input.trim().split(/\s+/);
    const [key, pin] = parts;

    if (!key || parts.length > 2) {
      return undefined;
    }

    const isPinSkip = (p: string | undefined): boolean => {
      if (!p) return true;
      const normalized = p.trim().toUpperCase().replace(/^\//, '');
      return normalized === '' || normalized === 'SKIP';
    };

    const credential = this.accounts.find((credential) => {
      if (credential.status === 'disabled' || credential.key !== key) {
        return false;
      }

      const accountHasSkipPin = isPinSkip(credential.pin);

      if (accountHasSkipPin) {
        return !pin || isPinSkip(pin);
      }

      return credential.pin === pin;
    });

    if (!credential) {
      return undefined;
    }

    return {
      key: credential.key,
      accountName: credential.accountName,
      balance: String(credential.balance),
    };
  }

  createAccount(input: {
    key: string;
    pin?: string;
    balance: number;
  }): AccountSummary | undefined {
    if (this.findAccount(input.key)) {
      return undefined;
    }

    const account: LoginCredential = {
      key: input.key,
      pin: input.pin,
      accountName: input.key,
      balance: input.balance,
      status: 'active',
    };

    this.accounts.push(account);
    this.saveAccounts();

    return this.toAccountSummary(account);
  }

  addBalance(key: string, amount: number): AccountSummary | undefined {
    const account = this.findAccount(key);

    if (!account) {
      return undefined;
    }

    account.balance += amount;
    this.saveAccounts();

    return this.toAccountSummary(account);
  }

  subtractBalance(key: string, amount: number): AccountSummary | undefined {
    const account = this.findAccount(key);

    if (!account) {
      return undefined;
    }

    account.balance = Math.max(0, account.balance - amount);
    this.saveAccounts();

    return this.toAccountSummary(account);
  }

  debitAccount(key: string, amount: number): AccountSummary | undefined {
    const account = this.findAccount(key);

    if (!account || account.status === 'disabled' || account.balance < amount) {
      return undefined;
    }

    account.balance -= amount;
    this.saveAccounts();

    return this.toAccountSummary(account);
  }

  findAccountSummary(key: string): AccountSummary | undefined {
    const account = this.findAccount(key);

    return account ? this.toAccountSummary(account) : undefined;
  }

  setAccountStatus(
    key: string,
    status: AccountStatus,
  ): AccountSummary | undefined {
    const account = this.findAccount(key);

    if (!account) {
      return undefined;
    }

    account.status = status;
    this.saveAccounts();

    return this.toAccountSummary(account);
  }

  deleteAccount(key: string): AccountSummary | undefined {
    const index = this.accounts.findIndex((account) => account.key === key);

    if (index === -1) {
      return undefined;
    }

    const [account] = this.accounts.splice(index, 1);
    this.saveAccounts();

    return this.toAccountSummary(account);
  }

  listAccounts(): AccountSummary[] {
    return this.accounts.map((account) => this.toAccountSummary(account));
  }

  private findAccount(key: string): LoginCredential | undefined {
    return this.accounts.find((account) => account.key === key);
  }

  private loadAccounts(): LoginCredential[] {
    if (!existsSync(this.accountDataPath)) {
      return this.botContent.loginCredentials();
    }

    return JSON.parse(
      readFileSync(this.accountDataPath, 'utf8'),
    ) as LoginCredential[];
  }

  private saveAccounts(): void {
    mkdirSync(dirname(this.accountDataPath), { recursive: true });
    writeFileSync(
      this.accountDataPath,
      `${JSON.stringify(this.accounts, null, 2)}\n`,
    );
  }

  private toAccountSummary(account: LoginCredential): AccountSummary {
    return {
      key: account.key,
      pin: account.pin ?? 'SKIP',
      accountName: account.accountName,
      balance: String(account.balance),
      status: account.status ?? 'active',
    };
  }
}
