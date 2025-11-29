/**
 * OpalForge Certificate Worker
 * 
 * Endpoints:
 * - POST /certificate          → Create/store a new certificate
 * - GET  /certificate/:id      → Get certificate data (for verification)
 * - GET  /certificate/:id/pdf  → Generate and download PDF
 * - GET  /qr/:id               → Get QR code image for a certificate
 */

import { jsPDF } from "jspdf";
import QRCode from "qrcode";

// Types for Cloudflare bindings
interface Env {
  CERT_DB: D1Database;
  KV: KVNamespace;
}

interface CertificateData {
  certId: string;
  confidence: number;
  timestamp: string;
  qrPayload: string;
  status?: string;
}

// CORS headers for frontend access
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route parsing
      const pathParts = url.pathname.split('/').filter(Boolean);
      // pathParts: ['certificate', ':id', 'pdf'] or ['certificate', ':id'] or ['qr', ':id']

      // --- QR Code Image Endpoint ---
      if (pathParts[0] === 'qr' && pathParts[1]) {
        return await handleQRImage(pathParts[1], env);
      }

      // --- Certificate Endpoints ---
      if (pathParts[0] === 'certificate') {
        
        // POST /certificate - Create new certificate
        if (method === 'POST' && pathParts.length === 1) {
          return await handleCreateCertificate(request, env);
        }

        // GET /certificate/:id - Verify/lookup certificate
        if (method === 'GET' && pathParts[1] && pathParts.length === 2) {
          return await handleVerifyCertificate(pathParts[1], env);
        }

        // HEAD /certificate/:id - Quick existence check
        if (method === 'HEAD' && pathParts[1] && pathParts.length === 2) {
          return await handleCertificateExists(pathParts[1], env);
        }

        // GET /certificate/:id/pdf - Generate PDF
        if (method === 'GET' && pathParts[1] && pathParts[2] === 'pdf') {
          const certId = pathParts[1];
          const qrData = url.searchParams.get('qrData') || `https://opalforge.tech/?verify=${certId}`;
          const confidence = url.searchParams.get('confidence') || '0';
          return await handleGeneratePDF(certId, qrData, parseFloat(confidence), env);
        }
      }

      // --- Health Check ---
      if (url.pathname === '/health' || url.pathname === '/') {
        return new Response(JSON.stringify({ 
          status: 'ok', 
          service: 'OpalForge Certificate Worker',
          timestamp: new Date().toISOString()
        }), {
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders 
          }
        });
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), { 
        status: 500, 
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};

// --- Handler Functions ---

async function handleCreateCertificate(request: Request, env: Env): Promise<Response> {
  try {
    const data: CertificateData = await request.json();
    
    // Validate required fields
    if (!data.certId || data.confidence === undefined) {
      return new Response(JSON.stringify({ error: 'Missing required fields: certId, confidence' }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Store in D1 database
    await env.CERT_DB.prepare(`
      INSERT INTO certificates (cert_id, confidence, timestamp, qr_payload, status)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      data.certId,
      data.confidence,
      data.timestamp || new Date().toISOString(),
      data.qrPayload || `https://opalforge.tech/?verify=${data.certId}`,
      'active'
    ).run();

    // Also cache in KV for fast lookups (expires in 1 year)
    await env.KV.put(`cert:${data.certId}`, JSON.stringify({
      certId: data.certId,
      confidence: data.confidence,
      timestamp: data.timestamp || new Date().toISOString(),
      status: 'active'
    }), { expirationTtl: 31536000 });

    console.log(`Certificate created: ${data.certId}`);

    return new Response(JSON.stringify({ 
      success: true, 
      certId: data.certId,
      message: 'Certificate stored successfully'
    }), {
      status: 201,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });

  } catch (error) {
    console.error('Create certificate error:', error);
    
    // Check if it's a duplicate key error
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return new Response(JSON.stringify({ error: 'Certificate ID already exists' }), {
        status: 409,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    
    throw error;
  }
}

async function handleVerifyCertificate(certId: string, env: Env): Promise<Response> {
  // First try KV cache (faster)
  const cached = await env.KV.get(`cert:${certId}`);
  
  if (cached) {
    console.log(`Certificate found in cache: ${certId}`);
    return new Response(cached, {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Fall back to D1 database
  const result = await env.CERT_DB.prepare(`
    SELECT cert_id as certId, confidence, timestamp, status 
    FROM certificates 
    WHERE cert_id = ?
  `).bind(certId).first();

  if (result) {
    // Cache the result for future lookups
    await env.KV.put(`cert:${certId}`, JSON.stringify(result), { expirationTtl: 31536000 });
    
    console.log(`Certificate found in D1: ${certId}`);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  return new Response(JSON.stringify({ error: 'Certificate not found' }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

async function handleCertificateExists(certId: string, env: Env): Promise<Response> {
  // Quick existence check
  const cached = await env.KV.get(`cert:${certId}`);
  
  if (cached) {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const result = await env.CERT_DB.prepare(`
    SELECT 1 FROM certificates WHERE cert_id = ?
  `).bind(certId).first();

  if (result) {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  return new Response(null, { status: 404, headers: corsHeaders });
}

async function handleGeneratePDF(
  certId: string, 
  qrData: string, 
  confidence: number,
  env: Env
): Promise<Response> {
  
  // Generate QR code as data URL
  const qrDataUrl = await QRCode.toDataURL(qrData, {
    width: 200,
    margin: 2,
    color: {
      dark: '#000040',
      light: '#FFFFFF'
    }
  });

  // Create PDF
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4" // 297mm x 210mm
  });

  const pageWidth = 297;
  const pageHeight = 210;
  const centerX = pageWidth / 2;

  // --- Certificate Design ---
  
  // Background gradient effect (simulated with rectangles)
  doc.setFillColor(249, 249, 249);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  
  // Top decorative bar
  doc.setFillColor(0, 0, 64); // Navy
  doc.rect(0, 0, pageWidth, 8, 'F');
  
  // Bottom decorative bar
  doc.setFillColor(0, 0, 64);
  doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');

  // Gold accent lines
  doc.setDrawColor(184, 134, 11); // Gold
  doc.setLineWidth(0.5);
  doc.rect(15, 15, pageWidth - 30, pageHeight - 30);
  doc.rect(18, 18, pageWidth - 36, pageHeight - 36);

  // Header - OpalForge Logo/Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(184, 134, 11); // Gold
  doc.text("OPALFORGE", centerX, 35, { align: "center" });
  
  // Subtitle
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("LUXURY AUTHENTICATION SERVICE", centerX, 42, { align: "center" });

  // Main Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(0, 0, 64); // Navy
  doc.text("Certificate of Authenticity", centerX, 65, { align: "center" });

  // Decorative line under title
  doc.setDrawColor(184, 134, 11);
  doc.setLineWidth(1);
  doc.line(centerX - 60, 72, centerX + 60, 72);

  // Certificate ID
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(60, 60, 60);
  doc.text("Certificate ID", centerX, 90, { align: "center" });
  
  doc.setFont("courier", "bold");
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 64);
  doc.text(certId, centerX, 100, { align: "center" });

  // Confidence Score
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(60, 60, 60);
  doc.text("Authentication Score", centerX, 120, { align: "center" });
  
  // Score with color based on confidence
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  if (confidence >= 85) {
    doc.setTextColor(34, 197, 94); // Green
  } else if (confidence >= 50) {
    doc.setTextColor(234, 179, 8); // Yellow
  } else {
    doc.setTextColor(239, 68, 68); // Red
  }
  doc.text(`${confidence.toFixed(1)}%`, centerX, 132, { align: "center" });

  // Issue Date
  const issueDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Issued: ${issueDate}`, centerX, 150, { align: "center" });

  // QR Code (positioned in bottom right)
  doc.addImage(qrDataUrl, "PNG", pageWidth - 65, pageHeight - 65, 40, 40);
  
  // QR Code label
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text("Scan to verify", pageWidth - 45, pageHeight - 22, { align: "center" });

  // Footer text
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text("This certificate was generated by OpalForge AI Authentication System", centerX, pageHeight - 20, { align: "center" });
  doc.text("opalforge.tech", centerX, pageHeight - 15, { align: "center" });

  // Generate PDF output
  const pdfOutput = doc.output("arraybuffer");

  // Optionally cache the PDF in KV
  await env.KV.put(`pdf:${certId}`, pdfOutput, { 
    expirationTtl: 86400, // 24 hours
    metadata: { generatedAt: new Date().toISOString() }
  });

  return new Response(pdfOutput, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="OpalForge_${certId}.pdf"`,
      ...corsHeaders
    }
  });
}

async function handleQRImage(certId: string, env: Env): Promise<Response> {
  const qrPayload = `https://opalforge.tech/?verify=${certId}`;
  
  // Generate QR as PNG buffer
  const qrBuffer = await QRCode.toBuffer(qrPayload, {
    type: 'png',
    width: 300,
    margin: 2,
    color: {
      dark: '#000040',
      light: '#FFFFFF'
    }
  });

  return new Response(qrBuffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      ...corsHeaders
    }
  });
}
