import {
  IsArray,
  IsNotEmpty,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsString,
  IsNumber,
} from 'class-validator';

export class CheckSerialsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  serialNumbers!: string[];

  @IsNotEmpty()
  @IsNumber()
  purchaseId!: number;
}
