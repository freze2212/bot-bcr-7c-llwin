import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { AccountModule } from './account/account.module';
import { AdminModule } from './admin/admin.module';
import { BotContentModule } from './bot/bot-content.module';
import { BotModule } from './bot/bot.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TelegrafModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isTest = configService.get<string>('NODE_ENV') === 'test';

        return {
          token: isTest
            ? 'test-token'
            : configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN'),
          launchOptions: isTest ? false : undefined,
        };
      },
    }),
    BotContentModule,
    AccountModule,
    AdminModule,
  ],
  providers: [BotModule],
})
export class AppModule {}
