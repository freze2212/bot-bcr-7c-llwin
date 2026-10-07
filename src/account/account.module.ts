import { Module } from '@nestjs/common';
import { BotContentModule } from '../bot/bot-content.module';
import { AccountService } from './account.service';

@Module({
  imports: [BotContentModule],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
