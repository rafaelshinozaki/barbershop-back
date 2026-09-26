import { Field, InputType } from '@nestjs/graphql';
import { IsString } from 'class-validator';

@InputType()
export class StartSoloPracticeInput {
  @Field()
  @IsString()
  name: string;

  @Field()
  @IsString()
  city: string;

  @Field()
  @IsString()
  state: string;

  @Field()
  @IsString()
  country: string;

  @Field()
  @IsString()
  address: string;

  @Field()
  @IsString()
  postalCode: string;

  @Field()
  @IsString()
  phone: string;
}
