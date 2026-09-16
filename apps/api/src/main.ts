import "reflect-metadata";
import { StandardSchemaValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule, type SwaggerDocumentOptions } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { createSchema } from "zod-openapi";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("v1");
  app.use(cookieParser(config.cookieSecret));
  app.enableCors({ origin: config.webOrigin, credentials: true });
  app.useGlobalPipes(new StandardSchemaValidationPipe({ transform: true }));

  const documentOptions: SwaggerDocumentOptions = {
    standardSchemaConverter: (schema, { schemaType }) => {
      const converted = createSchema(schema as never, {
        io: schemaType,
        openapiVersion: "3.0.0",
      });
      return { schema: converted.schema, components: converted.components };
    },
  };

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Jiwar API")
    .setDescription("Community notices near a chosen location")
    .setVersion("1.0")
    .build();

  SwaggerModule.setup(
    "api/docs",
    app,
    () => SwaggerModule.createDocument(app, swaggerConfig, documentOptions),
  );

  await app.listen(config.port);
  console.log(`Jiwar API listening on http://localhost:${config.port}`);
}

bootstrap();
