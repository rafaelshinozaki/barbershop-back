import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class CreateSocialPostInput {
  @Field()
  caption: string;

  @Field()
  imageKey: string;

  @Field()
  scheduledFor: string;

  @Field()
  postToFacebook: boolean;

  @Field()
  postToInstagram: boolean;
}
