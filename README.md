
# File: README.md - Setup instructions
# 🍽️ Recipe Enrichment Dashboard

Automated AI-powered recipe database enrichment with web interface.

## 🚀 Quick Deploy to Vercel

1. **Fork this repository** or create new one with these files

2. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

3. **Deploy:**
   ```bash
   vercel --prod
   ```

4. **Add environment variables in Vercel Dashboard:**
   - Go to your project settings
   - Add each variable from `.env.example`

## 🔧 Required Environment Variables

### Notion Integration Token
1. Go to https://www.notion.so/my-integrations
2. Create "Recipe Enricher" integration
3. Copy the Internal Integration Token
4. Share your Recipe Book database with the integration

### OpenAI API Key
1. Go to https://platform.openai.com/api-keys
2. Create new API key
3. Copy the key (starts with `sk-`)

### Gmail Credentials
1. Enable 2-factor authentication on Gmail
2. Go to https://myaccount.google.com/apppasswords
3. Generate app password for "Mail"
4. Use this 16-character password (not your Gmail password)

## 📊 Features

- **🤖 AI Analysis:** GPT-4 powered recipe categorization
- **🖼️ Image Extraction:** Automatic image scraping from source URLs
- **📧 Email Reports:** Weekly HTML email notifications
- **🎯 Smart Suggestions:** Meal types, cuisines, tags, ingredients
- **📝 Title Standardization:** Clean, consistent recipe naming
- **🔄 Web Interface:** Visual review and approval system
- **⏰ Automated:** Weekly cron job processing
- **🛡️ Safe:** Never overwrites existing data

## 🖥️ Usage

1. **Automatic Weekly Processing:**
   - Runs every Monday at 9 AM UTC
   - Processes recipes with missing data
   - Sends email with suggestions

2. **Manual Processing:**
   - Visit your deployed app URL
   - Click "Run AI Analysis"
   - Review suggestions in web interface

3. **Review & Apply:**
   - Check email or web interface
   - Copy suggestions or edit directly in Notion
   - System skips completed recipes next time

## 📁 File Structure

```
recipe-enrichment/
├── index.html              # Main web interface
├── api/
│   ├── enrichment.js       # Main processing API
│   └── apply-changes.js    # Apply changes to Notion
├── vercel.json             # Vercel configuration
├── package.json            # Dependencies
└── README.md               # This file
```

## 🔧 Customization

### Processing Limits
Edit `api/enrichment.js`:
```javascript
page_size: 20  // Change from 15 to process more recipes
```

### Email Schedule
Edit `vercel.json`:
```json
"schedule": "0 9 * * 3"  // Change to Wednesday
```

### Add Custom Options
Update the arrays in `api/enrichment.js`:
```javascript
const CUISINE_OPTIONS = [
  "Italian", "French", "Your-Custom-Cuisine"
];
```

## 🚨 Troubleshooting

**No recipes found:**
- Check Notion integration has database access
- Verify database ID matches your Recipe Book

**AI analysis fails:**
- Check OpenAI API key and credits
- Verify rate limits

**Email not sending:**
- Use Gmail app password, not regular password
- Enable 2FA on Gmail account

## 📞 Support

- Vercel deployment issues: https://vercel.com/docs
- Notion API: https://developers.notion.com/
- OpenAI API: https://platform.openai.com/docs

---

Your recipe database will be transformed into a well-organized, consistently tagged, and visually rich collection!
