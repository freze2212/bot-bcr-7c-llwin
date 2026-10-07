import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { BotModule } from './../src/bot/bot.module';

describe('Bot application (e2e)', () => {
  let moduleFixture: TestingModule;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleFixture.init();
  });

  afterEach(async () => {
    await moduleFixture.close().catch((error: unknown) => {
      if (error instanceof Error && error.message === 'Bot is not running!') {
        return;
      }

      throw error;
    });
  });

  it('starts the bot module without an HTTP API', () => {
    expect(moduleFixture.get(BotModule)).toBeDefined();
  });
});
