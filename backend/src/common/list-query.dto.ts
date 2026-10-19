import { Type, Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { trimValue } from './validation';
export class ListQueryDto {
 @ValidateIf((_o,v)=>v!==undefined) @Type(()=>Number) @IsInt() @Min(1) @Max(1000000) page?:number;
 @Type(()=>Number) @IsInt() @Min(1) @Max(100) limit?:number=20;
 @ValidateIf((_o,v)=>v!==undefined) @Transform(trimValue) @IsString() @Length(0,100) search?:string;
 @ValidateIf((_o,v)=>v!==undefined) @IsString() @Length(0,20) estado?:string;
 @ValidateIf((_o,v)=>v!==undefined) @Transform(trimValue) @IsString() @Length(0,100) categoria?:string;
 @ValidateIf((_o,v)=>v!==undefined) @Transform(trimValue) @IsString() @Length(0,100) interes?:string;
 @ValidateIf((_o,v)=>v!==undefined) @IsIn(['chatbot','other']) channel?:string;
}
export function pageArgs(q:ListQueryDto): {take?:number;skip?:number} {return q.page===undefined?{}:{take:q.limit||20,skip:(q.page-1)*(q.limit||20)};}
export function pageResult(q:ListQueryDto,total:number){return q.page===undefined?{}:{pagination:{total,page:q.page,limit:q.limit||20,pages:Math.ceil(total/(q.limit||20))}};}
