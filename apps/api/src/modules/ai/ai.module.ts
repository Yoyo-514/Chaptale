import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { ToolsModule } from '../tools/tools.module';
import { AgentService } from './agent.service';
import { ModelService } from './model.service';

@Module({
  imports: [ContextModule, ToolsModule],
  providers: [AgentService, ModelService],
  exports: [AgentService, ModelService]
})
export class AiModule {}
