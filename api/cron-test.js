


export default async function handler(req, res) {
  // This endpoint helps test if your cron job is working
  const now = new Date().toISOString();
  
  console.log(`Cron test endpoint hit at ${now}`);
  
  // You can manually trigger enrichment here if needed
  if (req.query.trigger === 'enrichment') {
    try {
      const enrichmentResponse = await fetch(`${req.headers.origin}/api/enrichment`, {
        method: 'POST'
      });
      const result = await enrichmentResponse.json();
      
      return res.status(200).json({
        message: 'Cron test - enrichment triggered',
        timestamp: now,
        enrichmentResult: result
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Cron test - enrichment failed',
        timestamp: now,
        error: error.message
      });
    }
  }
  
  res.status(200).json({
    message: 'Cron job is working!',
    timestamp: now,
    tip: 'Add ?trigger=enrichment to run the enrichment process'
  });
}