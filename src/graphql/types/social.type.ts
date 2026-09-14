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

  @Field({ nullable: true })
  errorMessage?: string;

  @Field()
  createdAt: string;
}

@ObjectType()
export class SocialPostImageUploadUrlType {
  @Field()
  uploadUrl: string;

  @Field()
  imageKey: string;
}
