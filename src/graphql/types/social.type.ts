import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class SocialConnectionType {
  @Field()
  facebookPageName: string;

  @Field({ nullable: true })
  instagramUsername?: string;

  @Field()
  connectedAt: string;
}

@ObjectType()
export class SocialPageOptionType {
  @Field()
  id: string;

  @Field()
  name: string;
}

@ObjectType()
export class SocialPostType {
  @Field(() => Int)
  id: number;

  @Field()
  caption: string;

  @Field()
  imageUrl: string;

  @Field()
  postToFacebook: boolean;

  @Field()
  postToInstagram: boolean;

  @Field()
  scheduledFor: string;

  @Field()
  status: string;

  @Field({ nullable: true })
  publishedAt?: string;

  @Field({ description: 'Já saiu no Facebook (a nova tentativa vai só para a rede que falhou)' })
  publishedToFacebook: boolean;

  @Field({ description: 'Já saiu no Instagram (a nova tentativa vai só para a rede que falhou)' })
  publishedToInstagram: boolean;

  @Field({ nullable: true })
  errorMessage?: string;

  @Field()
  createdAt: string;
}
