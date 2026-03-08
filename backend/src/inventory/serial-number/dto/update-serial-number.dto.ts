import { PartialType } from '@nestjs/mapped-types';
import { CreateSerialNumberDto } from './create-serial-number.dto';

export class UpdateSerialNumberDto extends PartialType(CreateSerialNumberDto) {}
