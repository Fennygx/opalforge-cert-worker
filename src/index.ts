export default {
  async fetch(request, env, ctx) {

    if (request.method === 'POST' && new URL(request.url).pathname === '/') {
      try {
        const data = await request.json();
        const userName = data.name || 'No Name Provided';

        // Placeholder for D1/KV usage
        // env.KV will store the last person to request a certificate
        await env.KV.put('latest_user', userName); 

        return new Response(JSON.stringify({
          status: 'success',
          message: `Received data for: ${userName}. Generation logic pending.`,
          dataReceived: data
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        });

      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Failed to process request body. Ensure data is valid JSON.',
          error: error.message
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 400
        });
      }
    }

    return new Response(
      'Worker is running. Send a POST request with JSON data to generate a certificate.', 
      { status: 200 }
    );
  }
}
