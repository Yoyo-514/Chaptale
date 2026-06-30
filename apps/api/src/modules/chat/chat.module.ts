import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContextModule } from '../context/context.module';
import { ChatController } from './chat.controller';

@Module({
  imports: [AiModule, ContextModule],
  controllers: [ChatController]
})
export class ChatModule {}
