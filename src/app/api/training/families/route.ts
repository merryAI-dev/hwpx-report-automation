import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { handleApiError } from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/persistence/client";

/**
 * GET  /api/training/families        - List all report families
 * POST /api/training/families        - Create a new report family
 */

export const GET = withApiAuth(async () => {
  try {
    const families = await prisma.reportFamily.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { packets: true, schemas: true } },
      },
    });
    return NextResponse.json({ families });
  } catch (err) {
    return handleApiError(err, "/api/training/families");
  }
});

export const POST = withApiAuth(async (req, { email }) => {
  try {
    const body = (await req.json()) as {
      name?: string;
      description?: string;
    };

    if (!body.name?.trim()) {
      throw new ValidationError("name 필드가 필요합니다.");
    }

    const existing = await prisma.reportFamily.findUnique({
      where: { name: body.name.trim() },
    });
    if (existing) {
      throw new ValidationError(`'${body.name}' 이름의 ReportFamily가 이미 존재합니다.`);
    }

    const family = await prisma.reportFamily.create({
      data: {
        name: body.name.trim(),
        description: body.description?.trim() ?? "",
      },
    });

    return NextResponse.json({ family }, { status: 201 });
  } catch (err) {
    return handleApiError(err, "/api/training/families");
  }
});
