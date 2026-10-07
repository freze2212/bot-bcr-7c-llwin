import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { BotContentModule } from '../bot/bot-content.module';
import { Admin } from './admin';

@Module({
  imports: [AccountModule, BotContentModule],
  providers: [Admin],
})
export class AdminModule {}
