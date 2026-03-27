import { Resolver, Query, Mutation, Args, Int, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import {
  Barbershop,
  BarbershopCustomer,
  Customer,
  Barber,
  Network,
  NetworkDashboardStats,
  BarbershopServiceType,
  ProductCategoryType,
  BarbershopProductType,
  BarberScheduleType,
  BarberTimeOffType,
  Appointment,
  WalkIn,
  ServiceHistory,
  Sale,
} from '../types/barbershop.type';
import {
  CreateBarbershopInput,
  UpdateBarbershopInput,
  CreateCustomerInput,
  UpdateCustomerInput,
  CreateBarberInput,
  UpdateBarberInput,
  CreateBarbershopServiceInput,
  UpdateBarbershopServiceInput,
  CreateProductCategoryInput,
  UpdateProductCategoryInput,
  CreateBarbershopProductInput,
  UpdateBarbershopProductInput,
  CreateBarberScheduleInput,
  UpdateBarberScheduleInput,
  CreateBarberTimeOffInput,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  CreateWalkInInput,
  WalkInServiceInput,
  CreateSaleInput,
  CreateSaleItemInput,
  UpdateSaleInput,
  UpdateNetworkInput,
} from '../dto/barbershop.dto';
import { BarbershopService } from '../../barbershop/barbershop.service';
import { S3Service } from '../../aws/s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';

@Resolver(() => Barbershop)
export class BarbershopResolver {
  constructor(
    private readonly barbershopService: BarbershopService,
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  // ============ BARBERSHOP ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Barbershop)
  async createBarbershop(
    @Args('input') input: CreateBarbershopInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.createBarbershop(user.id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [Barbershop])
  async myBarbershops(@CurrentUser() user: UserDTO) {
    return this.barbershopService.getUserBarbershops(user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => Barbershop, { nullable: true })
  async barbershop(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.getBarbershop(user.id, id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Barbershop)
  async updateBarbershop(
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateBarbershopInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.updateBarbershop(user.id, id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteBarbershop(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.deleteBarbershop(user.id, id);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @ResolveField(() => [String])
  async availableModules(@Parent() barbershop: { id: number }) {
    return this.barbershopService.getAvailableModules(barbershop.id);
  }

  // ============ NETWORK (FRANQUIA) ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => Network, { nullable: true })
  async myNetwork(@CurrentUser() user: UserDTO) {
    return this.barbershopService.getMyNetwork(user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Network)
  async updateNetwork(
    @Args('input') input: UpdateNetworkInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.updateNetwork(user.id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => NetworkDashboardStats)
  async networkDashboardStats(@CurrentUser() user: UserDTO) {
    return this.barbershopService.getNetworkDashboardStats(user.id);
  }

  // ============ CUSTOMERS ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => BarbershopCustomer)
  async createCustomer(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: CreateCustomerInput,
    @CurrentUser() user: UserDTO,
  ) {
    const { barbershopId: _, ...rest } = input;
    const data = { ...rest, birthDate: rest.birthDate ? new Date(rest.birthDate) : undefined };
    return this.barbershopService.createCustomer(user.id, barbershopId, data);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [Customer])
  async barbershopCustomers(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('search', { nullable: true }) search?: string,
  ) {
    return this.barbershopService.getCustomers(user.id, barbershopId, { search });
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => Customer, { nullable: true })
  async customer(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.getCustomer(user.id, barbershopId, id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Customer)
  async updateCustomer(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateCustomerInput,
    @CurrentUser() user: UserDTO,
  ) {
    const data: any = { ...input };
    if (input.birthDate) data.birthDate = new Date(input.birthDate);
    return this.barbershopService.updateCustomer(user.id, barbershopId, id, data);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteCustomer(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.deleteCustomer(user.id, barbershopId, id);
    return true;
  }

  // ============ BARBERS ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Barber)
  async createBarber(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: CreateBarberInput,
    @CurrentUser() user: UserDTO,
  ) {
    const { barbershopId: _, hireDate, ...rest } = input;
    const data = { ...rest, hireDate: hireDate ? new Date(hireDate) : undefined };
    return this.barbershopService.createBarber(user.id, barbershopId, data);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [Barber])
  async barbershopBarbers(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.getBarbers(user.id, barbershopId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Barber)
  async updateBarber(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateBarberInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.updateBarber(user.id, barbershopId, id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteBarber(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.deleteBarber(user.id, barbershopId, id);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async reactivateBarber(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.reactivateBarber(user.id, barbershopId, id);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async requestBarberPasswordReset(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.requestBarberPasswordReset(user.id, barbershopId, id);
    return true;
  }

  // ============ SERVICES ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => BarbershopServiceType)
  async createBarbershopService(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: CreateBarbershopServiceInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.createService(user.id, barbershopId, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [BarbershopServiceType])
  async barbershopServices(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.getServices(user.id, barbershopId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => BarbershopServiceType)
  async updateBarbershopService(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateBarbershopServiceInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.updateService(barbershopId, id, user.id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteBarbershopService(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.deleteService(user.id, barbershopId, id);
    return true;
  }

  // ============ PRODUCTS ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [ProductCategoryType])
  async barbershopProductCategories(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.getProductCategories(user.id, barbershopId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => ProductCategoryType)
  async createProductCategory(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: CreateProductCategoryInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.createProductCategory(user.id, barbershopId, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => ProductCategoryType)
  async updateProductCategory(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateProductCategoryInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.updateProductCategory(user.id, barbershopId, id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteProductCategory(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.deleteProductCategory(user.id, barbershopId, id);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => BarbershopProductType)
  async createBarbershopProduct(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: CreateBarbershopProductInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.createProduct(user.id, barbershopId, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [BarbershopProductType])
  async barbershopProducts(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.getProducts(user.id, barbershopId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => BarbershopProductType)
  async updateBarbershopProduct(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateBarbershopProductInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.updateProduct(user.id, barbershopId, id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteBarbershopProduct(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.deleteProduct(user.id, barbershopId, id);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => String)
  async getProductPhotoUploadUrl(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('productId', { type: () => Int }) productId: number,
    @Args('fileExtension', { nullable: true }) fileExtension?: string,
    @Args('contentType', { nullable: true }) contentType?: string,
    @CurrentUser() user?: UserDTO,
  ): Promise<string> {
    if (!user?.id) throw new Error('Não autorizado');
    await this.barbershopService.getBarbershop(user.id, barbershopId);
    const product = await this.prisma.barbershopProduct.findFirst({
      where: { id: productId, barbershopId },
    });
    if (!product) {
      throw new Error('Produto não encontrado');
    }
    const ext = fileExtension || 'jpg';
    const imageKey = `products/${barbershopId}/${productId}/photo.${ext}`;
    const uploadUrl = await this.s3Service.getUploadUrl(imageKey, contentType);
    await this.prisma.barbershopProduct.update({
      where: { id: productId },
      data: { imageKey },
    });
    return uploadUrl;
  }

  // ============ BARBERSHOP PHOTO ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => String)
  async getBarbershopPhotoUploadUrl(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('fileExtension', { nullable: true }) fileExtension?: string,
    @Args('contentType', { nullable: true }) contentType?: string,
    @CurrentUser() user?: UserDTO,
  ): Promise<string> {
    if (!user?.id) throw new Error('Não autorizado');
    await this.barbershopService.getBarbershop(user.id, barbershopId);
    const ext = fileExtension || 'jpg';
    const photoKey = `barbershops/${barbershopId}/photo.${ext}`;
    const uploadUrl = await this.s3Service.getUploadUrl(photoKey, contentType);
    await this.prisma.barbershop.update({
      where: { id: barbershopId },
      data: { photoKey },
    });
    return uploadUrl;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async removeBarbershopPhoto(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user?: UserDTO,
  ): Promise<boolean> {
    if (!user?.id) throw new Error('Não autorizado');
    await this.barbershopService.getBarbershop(user.id, barbershopId);
    await this.prisma.barbershop.update({
      where: { id: barbershopId },
      data: { photoKey: null },
    });
    return true;
  }

  // ============ BARBER SCHEDULE ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => BarberScheduleType)
  async createBarberSchedule(
    @Args('input') input: CreateBarberScheduleInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.createBarberSchedule(user.id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [BarberScheduleType])
  async barberSchedules(
    @Args('barberId', { type: () => Int }) barberId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.getBarberSchedulesByBarber(user.id, barberId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => BarberScheduleType)
  async updateBarberSchedule(
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateBarberScheduleInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.updateBarberSchedule(id, user.id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteBarberSchedule(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.deleteBarberSchedule(id, user.id);
    return true;
  }

  // ============ BARBER TIME OFF ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => BarberTimeOffType)
  async createBarberTimeOff(
    @Args('input') input: CreateBarberTimeOffInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.createBarberTimeOff(user.id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [BarberTimeOffType])
  async barberTimeOffs(
    @CurrentUser() user: UserDTO,
    @Args('barberId', { type: () => Int }) barberId: number,
    @Args('startAt', { nullable: true }) startAt?: string,
    @Args('endAt', { nullable: true }) endAt?: string,
  ) {
    return this.barbershopService.getBarberTimeOffsByBarber(user.id, barberId, {
      startAt: startAt ? new Date(startAt) : undefined,
      endAt: endAt ? new Date(endAt) : undefined,
    });
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteBarberTimeOff(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.deleteBarberTimeOff(user.id, id);
    return true;
  }

  // ============ APPOINTMENTS ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Appointment)
  async createAppointment(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: CreateAppointmentInput,
    @CurrentUser() user: UserDTO,
  ) {
    const { barbershopId: _b, ...rest } = input;
    return this.barbershopService.createAppointment(user.id, barbershopId, {
      ...rest,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
    });
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [Appointment])
  async barbershopAppointments(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('startAt', { nullable: true }) startAt?: string,
    @Args('endAt', { nullable: true }) endAt?: string,
    @Args('barberId', { type: () => Int, nullable: true }) barberId?: number,
    @Args('status', { nullable: true }) status?: string,
  ) {
    return this.barbershopService.getAppointments(user.id, barbershopId, {
      startFrom: startAt ? new Date(startAt) : undefined,
      startTo: endAt ? new Date(endAt) : undefined,
      barberId,
      status,
    });
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => Appointment, { nullable: true })
  async appointment(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.getAppointment(user.id, barbershopId, id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Appointment)
  async updateAppointment(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateAppointmentInput,
    @CurrentUser() user: UserDTO,
  ) {
    const data: any = { ...input };
    if (input.startAt) data.startAt = new Date(input.startAt);
    if (input.endAt) data.endAt = new Date(input.endAt);
    return this.barbershopService.updateAppointment(user.id, barbershopId, id, data);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteAppointment(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.barbershopService.deleteAppointment(user.id, barbershopId, id);
    return true;
  }

  // ============ WALK-INS ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => WalkIn)
  async createWalkIn(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: CreateWalkInInput,
    @CurrentUser() user: UserDTO,
  ) {
    const { barbershopId: _b, ...rest } = input;
    return this.barbershopService.createWalkIn(user.id, barbershopId, rest);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [WalkIn])
  async barbershopWalkIns(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('status', { nullable: true }) status?: string,
  ) {
    return this.barbershopService.getWalkIns(user.id, barbershopId, { status });
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => WalkIn)
  async updateWalkInStatus(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @Args('status') status: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.updateWalkInStatus(user.id, barbershopId, id, status);
  }

  // ============ SERVICE HISTORY ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [ServiceHistory])
  async customerServiceHistory(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('customerId', { type: () => Int }) customerId: number,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ) {
    return this.barbershopService.getCustomerServiceHistory(
      user.id,
      barbershopId,
      customerId,
      limit ?? 50,
    );
  }

  // ============ SALES ============

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Sale)
  async createSale(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: CreateSaleInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.createSale(user.id, barbershopId, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Sale)
  async updateSale(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateSaleInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.updateSale(user.id, barbershopId, id, input);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteSale(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.barbershopService.deleteSale(user.id, barbershopId, id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [Sale])
  async barbershopSales(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('startAt', { nullable: true }) startAt?: string,
    @Args('endAt', { nullable: true }) endAt?: string,
  ) {
    return this.barbershopService.getSales(user.id, barbershopId, {
      from: startAt ? new Date(startAt) : undefined,
      to: endAt ? new Date(endAt) : undefined,
    });
  }
}
