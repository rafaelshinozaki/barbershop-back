// src\common\decorators.ts
import { SetMetadata } from '@nestjs/common';

export const PublicRoute = () => SetMetadata('isPublic', true);
