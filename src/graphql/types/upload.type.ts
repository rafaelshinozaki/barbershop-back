import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class UploadFormFieldType {
  @Field()
  name: string;

  @Field()
  value: string;
}

/**
 * Formulário pré-assinado pra enviar uma imagem direto pro S3: POST
 * multipart pra `url` com todos os `fields` e o arquivo por último (campo
 * "file"). O S3 recusa arquivo acima do limite ou de outro tipo.
 */
@ObjectType()
export class PresignedUploadType {
  @Field()
  url: string;

  @Field(() => [UploadFormFieldType])
  fields: UploadFormFieldType[];

  /** Chave do arquivo no bucket */
  @Field()
  key: string;
}
