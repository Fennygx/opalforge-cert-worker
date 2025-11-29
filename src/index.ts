import { jsPDF } from "jspdf";
import QRCode from "qrcode";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- 1. ROUTE HANDLING ---
    // Look for requests to /certificate/:id
    const pathParts = url.pathname.split('/');
    // pathParts[0] is empty, [1] is 'certificate', [2] is the ID
    
    if (pathParts[1] === 'certificate' && pathParts[2]) {
      const certId = pathParts[2];
      
      // --- 2. EXTRACT THE CUSTOM QR DATA ---
      // This is the new strategic logic.
      // We look for ?qrData=... in the URL. 
      // If it exists, we use it. If not, we fallback to just the ID.
      const queryParams = url.searchParams;
      const qrPayload = queryParams.get('qrData') || certId; 
      
      console.log(`Generating Cert: ${certId} | QR Payload: ${qrPayload}`);

      // --- 3. GENERATE QR CODE IMAGE ---
      // Generate QR code as a data URL
      const qrDataUrl = await QRCode.toDataURL(qrPayload);

      // --- 4. GENERATE PDF ---
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4"
      });

      // -- (Your existing Styling/Design code goes here) --
      // Example: Background, Borders, Text...
      
      doc.setFontSize(22);
      doc.text(`Certificate of Authenticity`, 148.5, 40, { align: "center" });
      doc.setFontSize(16);
      doc.text(`ID: ${certId}`, 148.5, 60, { align: "center" });

      // -- ADD THE QR CODE --
      // x, y, width, height
      doc.addImage(qrDataUrl, "PNG", 220, 130, 40, 40); 
      
      // -- OUTPUT --
      const pdfOutput = doc.output("arraybuffer");

      return new Response(pdfOutput, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="OpalForge_${certId}.pdf"`,
          // Add CORS so your frontend can call this
          "Access-Control-Allow-Origin": "*" 
        }
      });
    }

    return new Response("OpalForge Certificate Worker: Invalid Endpoint", { status: 404 });
  }
};
