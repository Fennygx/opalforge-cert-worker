// src/index.ts

// --- 1. The Cleaned CSS Constant (Validated and ready) ---
const MINIFIED_CERTIFICATE_CSS_CLEAN = `@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap');body{background-color:#0d1a2d;color:#f0f8ff;font-family:'Orbitron',sans-serif;margin:0;padding:40px 20px;display:flex;justify-content:center;align-items:flex-start;min-height:100vh}.certificate-container{width:100%;max-width:900px;background-color:rgba(10,25,47,.9);border:1px solid #00c6ff;box-shadow:0 0 30px rgba(0,198,255,.5),inset 0 0 10px rgba(0,198,255,.3);padding:30px;border-radius:10px;text-align:center}.header h1{color:#00c6ff;font-size:2.5em;margin-bottom:5px}.header h2{font-size:1.1em;color:#c4d7e9;margin-top:0;padding-bottom:20px;border-bottom:1px solid rgba(0,198,255,.2)}.logo{width:60px;margin-bottom:10px}.certificate-id-box{background-color:#00c6ff;color:#0d1a2d;font-size:1.5em;font-weight:700;padding:15px;margin:20px 0;border-radius:5px;letter-spacing:1px}.content-grid{display:flex;text-align:left;margin-top:40px}.item-details,.auth-report{flex:1;padding-right:20px}.item-details h3,.auth-report h3{color:#00c6ff;border-bottom:2px solid rgba(0,198,255,.5);padding-bottom:10px;margin-bottom:20px}.detail-line{border-bottom:1px dashed rgba(255,255,255,.1);padding:10px 0;font-size:.9em;color:#c4d7e9}.authenticity-badge{text-align:center;padding-top:20px}.score-percent{font-size:2.5em;font-weight:700;color:#00ffaa;text-shadow:0 0 15px #00ffaa;margin:10px 0}.footer{border-top:1px solid rgba(0,198,255,.2);padding-top:20px;margin-top:40px;display:flex;justify-content:space-between;align-items:center}.tagline{font-size:.8em;color:#92a4b9}.trust-info{display:flex;align-items:center;font-size:.7em;color:#00c6ff}.qr-code{width:40px;height:40px;margin-right:10px}@media (max-width:600px){.content-grid{flex-direction:column}.certificate-container{padding:20px}.certificate-id-box{font-size:1.2em}.footer{flex-direction:column;text-align:center}}`;

// Define the structure of your environment variables
export interface Env {
    PDFSHIFT_API_KEY: string;
    cert_db: D1Database; // Renamed from CERT_DB to match usage
    PUBLIC_ASSET_URL: string;
}

// --- 2. The Complete HTML Body Content Function ---
function generateCertificateBody(certDetails: any, publicAssetBaseUrl: string): string {
    const statusText = certDetails.revoked === 1 ? "REVOKED" : "VALID";
    const scoreText = certDetails.score ? certDetails.score : "N/A";
    const dateText = certDetails.created_at ? certDetails.created_at.split(" ")[0] : "--";
    const certId = certDetails.id || 'N/A'; // Using 'id' to match D1 data
    
    return `
        <div class="certificate-container">
            <div class="header">
                <img src="${publicAssetBaseUrl}/OpalForge-Logo.png" alt="OpalForge Logo" class="logo">
                <h1>OPALFORGE</h1>
                <p class="sub-header">OFFICIAL AI AUTHENTICATION CERTIFICATE</p>
                <div class="certificate-id-box">CERTIFICATE ID: <span id="certificate-id-display">${certId}</span></div>
            </div>
            
            <div class="content-grid">
                <div class="item-details">
                    <h3>ITEM DETAILS</h3>
                    <div class="detail-line">RECIPIENT NAME: <span>${certDetails.recipient_name}</span></div>
                    <div class="detail-line">COURSE NAME: <span>${certDetails.course_name}</span></div>
                    <div class="detail-line">COMPLETION DATE: <span>${certDetails.completion_date}</span></div>
                    <div class="detail-line">STATUS: <span>${statusText}</span></div>
                </div>

                <div class="auth-report">
                    <h3>AUTHENTICATION REPORT</h3>
                    <div class="authenticity-badge">
                        <p class="confidence-score">AI CONFIDENCE SCORE</p>
                        <p class="score-percent" id="score">${scoreText}</p>
                        <p class="date" id="date">AUTHENTICATION DATE: ${dateText}</p>
                    </div>
                </div>
            </div>
            
            <div class="qr-section">
                <img src="${publicAssetBaseUrl}/qr-code-placeholder.png" alt="Scan to Verify" class="qr-placeholder">
                <p class="trust-text">FORGE UNBREAKABLE PROOF. OWN THE ETERNAL.</p>
            </div>
            
            <div class="footer">
                <p>Powered by UNIVERSAL TRUST OS</p>
            </div>
        </div>
    `;
}

// --- 3. The Main PDF Generation Logic (Using PDFShift) ---
async function createCertificatePDF(certId: string, env: Env) {
    // 1. D1 Lookup (Modified to use env.cert_db)
    const { results } = await env.cert_db.prepare("SELECT * FROM Certificates WHERE id = ?").bind(certId).all();
    const data = results[0];
    if (!data) {
        throw new Error("Certificate ID not found.");
    }
    const metadata = data.metadata ? JSON.parse(data.metadata) : {}; // Handle case where metadata might be null
    const certDetails = {
        ...data,
        ...metadata,
        score: metadata.score || "99.9%",
        id: certId // Ensure ID is used consistently
    };

    // 2. Generate Payloads
    const PDFSHIFT_ENDPOINT = 'https://api.pdfshift.io/v3/convert/raw';
    const authString = btoa(`${env.PDFSHIFT_API_KEY}:`);
    
    // NOTE: PUBLIC_ASSET_URL must be set in your Cloudflare Worker settings!
    const certificateBodyHtml = generateCertificateBody(certDetails, env.PUBLIC_ASSET_URL);

    const pdfShiftPayload = {
        source: certificateBodyHtml, 
        source_type: 'html',
        css: MINIFIED_CERTIFICATE_CSS_CLEAN, 
        options: {
            view_port: '1024x768',
            html_to_pdf: {
                print_media_type: false,
                wait_until: 'domcontentloaded',
            }
        },
        filename: `OpalForge_Cert_${certDetails.id}.pdf`
    };

    // 3. API Call
    const response = await fetch(PDFSHIFT_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${authString}`,
            'Accept': 'application/pdf'
        },
        body: JSON.stringify(pdfShiftPayload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('PDFShift API Error:', errorText);
        throw new Error(`PDF generation failed (Status: ${response.status}, Details: ${errorText})`);
    }

    return response.arrayBuffer();
}

// --- 4. Worker Fetch Handler ---
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        if (request.method !== "POST") {
            return new Response(JSON.stringify({ status: "OK", message: "Worker is running. Send POST request with certificate_id." }), {
                headers: { "Content-Type": "application/json" }
            });
        }
        try {
            const json = await request.json();
            const certId = json.certificate_id;
            if (!certId) {
                return new Response(JSON.stringify({ status: "ERROR", message: "Missing certificate_id in request body." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }
            const pdfBytes = await createCertificatePDF(certId, env);
            return new Response(pdfBytes, {
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": `attachment; filename="OpalForge_Cert_${certId}.pdf"`,
                    "Access-Control-Allow-Origin": "*"
                }
            });
        } catch (error) {
            console.error(error);
            return new Response(JSON.stringify({ status: "ERROR", message: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
    }
};
