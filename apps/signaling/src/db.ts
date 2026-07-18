/**
 * Cliente Prisma compartido (PostgreSQL): denuncias y baneos duraderos.
 * Redis lleva el estado caliente; si PostgreSQL no está disponible las
 * operaciones de moderación fallan con log, pero el chat sigue funcionando.
 */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
