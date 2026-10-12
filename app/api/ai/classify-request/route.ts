import { NextRequest } from 'next/server';
import { AiClassifierService } from '@/lib/services/ai-classifier-service';
import { ClassifyRequestInputSchema } from '@/lib/validation/schemas';
import { handleApiError, jsonResponse } from '@/lib/api-response';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = ClassifyRequestInputSchema.parse(body);

    const requestId = validated.requestId || validated.request_id;

    if (requestId) {
      // Classify and persist to request_ai_analysis table + log activity event
      const result = await AiClassifierService.classifyAndStore(
        requestId,
        validated.title,
        validated.description
      );
      return jsonResponse({
        ...result.analysis,
        analysisId: result.record.id,
        stored: true,
      });
    }

    // Pure classification & structured extraction (stateless / preview)
    const analysis = await AiClassifierService.classifyText(
      validated.title,
      validated.description
    );

    return jsonResponse(analysis);
  } catch (error) {
    return handleApiError(error);
  }
}
