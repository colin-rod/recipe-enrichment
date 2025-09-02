// Simple local server for testing the frontend
import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import dotenv from 'dotenv';

// Import our API handlers
import { handler as enrichmentHandler } from './api/enrichment.js';
import testNotionHandler from './api/test-notion.js';

// Load environment variables
dotenv.config();

const PORT = 3000;
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Simple MIME type mapping
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.ico': 'image/x-icon'
};

// Mock response object for API handlers
class MockResponse {
  constructor(realRes) {
    this.realRes = realRes;
    this.statusCode = 200;
    this.headers = {};
  }
  
  status(code) {
    this.statusCode = code;
    return this;
  }
  
  setHeader(name, value) {
    this.headers[name] = value;
  }
  
  json(data) {
    this.realRes.writeHead(this.statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...this.headers
    });
    this.realRes.end(JSON.stringify(data));
  }
  
  end() {
    this.realRes.writeHead(this.statusCode, this.headers);
    this.realRes.end();
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  console.log(`${req.method} ${pathname}`);

  // Handle API routes
  if (pathname.startsWith('/api/')) {
    const mockRes = new MockResponse(res);
    
    try {
      if (pathname === '/api/enrichment') {
        await enrichmentHandler(req, mockRes);
        return;
      } else if (pathname === '/api/test-notion') {
        await testNotionHandler(req, mockRes);
        return;
      } else {
        mockRes.status(404).json({ error: 'API endpoint not found' });
        return;
      }
    } catch (error) {
      console.error('API Error:', error);
      mockRes.status(500).json({ error: error.message });
      return;
    }
  }

  // Handle static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  // Security check - don't serve files outside project directory
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Check if file exists
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeType = mimeTypes[ext] || 'text/plain';

      res.writeHead(200, { 'Content-Type': mimeType });
      fs.createReadStream(filePath).pipe(res);
    } else if (pathname === '/favicon.ico') {
      // Handle missing favicon
      res.writeHead(404);
      res.end();
    } else {
      res.writeHead(404);
      res.end('File not found');
    }
  } catch (error) {
    console.error('File serving error:', error);
    res.writeHead(500);
    res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Local server running at http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🧪 Test Notion: http://localhost:${PORT}/api/test-notion`);
  console.log(`🤖 Enrichment API: http://localhost:${PORT}/api/enrichment`);
  console.log('\n✅ Environment variables loaded from .env');
  console.log(`   - Notion Token: ${process.env.NOTION_TOKEN ? 'Present' : 'Missing'}`);
  console.log(`   - OpenAI Key: ${process.env.OPENAI_API_KEY ? 'Present' : 'Missing'}`);
  console.log('\n💡 Press Ctrl+C to stop the server');
});