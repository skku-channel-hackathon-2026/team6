import { Module, type ExecutionContext } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ChannelAppModule, SignatureGuard } from "@channel.io/app-sdk-server";
import { channelAppOptions } from "./config.js";
import { CommandExtension, TutorialFunctions } from "./tutorial.functions.js";
import { ActivitiesController } from "./activities.js";

@Module({
  imports: [ChannelAppModule.forRoot(channelAppOptions)],
  controllers: [ActivitiesController],
  providers: [
    CommandExtension,
    TutorialFunctions,
    {
      provide: APP_GUARD,
      useFactory: () => {
        const signatureGuard = new SignatureGuard(channelAppOptions);
        return {
          canActivate(context: ExecutionContext) {
            // Only the explicit demo handlers are public; SDK routes stay signed.
            if (
              context.getClass() === ActivitiesController &&
              (context.getHandler() === ActivitiesController.prototype.list ||
                context.getHandler() ===
                  ActivitiesController.prototype.participation ||
                context.getHandler() ===
                  ActivitiesController.prototype.preference ||
                context.getHandler() ===
                  ActivitiesController.prototype.complete ||
                context.getHandler() ===
                  ActivitiesController.prototype.create ||
                context.getHandler() === ActivitiesController.prototype.remove)
            )
              return true;
            return signatureGuard.canActivate(context);
          },
        };
      },
    },
  ],
})
export class AppModule {}
