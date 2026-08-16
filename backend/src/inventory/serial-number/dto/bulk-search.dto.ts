import {
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsString,
} from 'class-validator';

export class BulkSearchDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  serialNumbers!: string[];
}
