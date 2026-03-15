// src\plan\plan.controller.ts
import { Body, Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiCookieAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PlanService } from './plan.service';
import { PlanDTO } from './dto/plan.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/roles.decorator';
import { Role } from '@/auth/interfaces/roles';

@ApiTags('plans')
@ApiCookieAuth()
@Controller('plans')
export class PlanController {
  constructor(private planService: PlanService) {}

  @Get('all')
  @ApiOperation({ summary: 'List all plans' })
  @ApiResponse({ status: 200, description: 'Array of plans' })
  getAllPlans() {
    return this.planService.findAllPlans();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get plan by id' })
  @ApiResponse({ status: 200, description: 'Plan data' })
  getPlan(@Param('id') id: string) {
    return this.planService.findPlanById(+id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Create a new plan' })
  @ApiResponse({ status: 201, description: 'Plan created' })
  @Post('create')
  createPlan(@Body() planData: PlanDTO) {
    return this.planService.createPlan(planData);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Update a plan' })
  @ApiResponse({ status: 200, description: 'Plan updated' })
  @Post('update')
  updatePlan(@Body() planData: PlanDTO) {
    return this.planService.updatePlan(planData.id, planData);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Remove a plan' })
  @ApiResponse({ status: 200, description: 'Plan removed' })
  @Post('remove')
  removePlan(@Body('planId') planId: number) {
    return this.planService.removePlan(planId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Sync plans with Stripe' })
  @ApiResponse({ status: 200, description: 'Plans synced with Stripe' })
  @Post('sync-stripe')
  syncWithStripe() {
    return this.planService.syncWithStripe();
  }
}
