// Local test for full AI enrichment process
import { Client } from '@notionhq/client';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_ID = "1b1ea313dfba4618915c4574ad7ed576";

// Options arrays (same as in the main app)
const CUISINE_OPTIONS = [
  "African", "American", "Asian", "Brazilian", "Chinese", "Dessert", 
  "French", "German", "Greek", "Hungarian", "Indian", "Italian", 
  "Japanese", "Korean", "Mediterranean", "Mexican", "Middle Eastern", 
  "Persian", "Peruvian", "Spanish", "Thai", "Vietnamese"
];

const MEAL_OPTIONS = [
  "Main Dish", "Side Dish", "Breakfast", "Dessert", "Snack", "Beverage"
];

const TAG_OPTIONS = [
  "Appetizer", "Baked", "Braised", "Breakfast", "Chocolate", "Citrusy",
  "Condiment", "Creamy", "Curry", "Drink", "Eggs", "Fish", "Grilled",
  "Herby", "No Bake", "Pasta", "Pickled", "Refreshing", "Roasted",
  "Salad", "Sandwich", "Savory", "Seafood", "Soup", "Spicy", "Steamed",
  "Stew", "Stir-Fry", "Sweet", "Tangy", "Traditional", "Vegan", "Vegetarian"
];

const INGREDIENT_OPTIONS = [
  "Beef", "Chicken", "Pork", "Fish", "Salmon", "Shrimp", "Eggs", "Cheese",
  "Pasta", "Rice", "Bread", "Potato", "Tomato", "Onions", "Garlic",
  "Spinach", "Broccoli", "Carrot", "Mushrooms", "Peppers", "Lemon",
  "Basil", "Herbs", "Ginger", "Chili", "Beans", "Cream", "Milk"
];

console.log('🤖 Testing AI Recipe Enrichment locally...\n');

// Check environment variables
if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN missing');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY missing');
  process.exit(1);
}

console.log('✅ Environment variables loaded\n');

async function extractRecipeFromURL(url) {
  if (!url) return null;
  
  try {
    console.log(`  🔍 Extracting data from: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
      }
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract recipe data using multiple strategies
    const recipeData = {
      title: $('h1').first().text().trim() || $('[class*="title"]').first().text().trim(),
      description: $('meta[name="description"]').attr('content') || 
                  $('[class*="description"]').first().text().trim(),
      ingredients: []
    };
    
    // Try to extract ingredients
    $('[class*="ingredient"], .recipe-ingredient, .ingredients li').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 2 && text.length < 100) {
        recipeData.ingredients.push(text);
      }
    });
    
    console.log(`    📝 Title: ${recipeData.title || 'Not found'}`);
    console.log(`    📄 Description: ${recipeData.description?.substring(0, 100) || 'Not found'}...`);
    console.log(`    🥕 Ingredients found: ${recipeData.ingredients.length}`);
    
    return recipeData;
  } catch (error) {
    console.log(`    ❌ Failed to extract: ${error.message}`);
    return null;
  }
}

async function analyzeRecipeWithAI(recipe, extractedData) {
  try {
    console.log(`  🧠 Analyzing with AI: ${recipe.name}`);
    
    // Prepare context from extracted data
    const context = extractedData ? `
      Extracted Title: ${extractedData.title || 'N/A'}
      Description: ${extractedData.description || 'N/A'}
      Sample Ingredients: ${extractedData.ingredients?.slice(0, 10).join(', ') || 'N/A'}
    ` : 'No extracted data available';

    const prompt = `
    Analyze this recipe and provide enrichment data:
    
    Recipe Name: ${recipe.name}
    Source Link: ${recipe.link || 'N/A'}
    ${context}
    
    Current Data:
    - Meal: ${recipe.current_meal || 'Empty'}
    - Cuisine: ${recipe.current_cuisine || 'Empty'}
    - Tags: ${recipe.current_tags?.join(', ') || 'Empty'}
    - Ingredients: ${recipe.current_ingredients?.join(', ') || 'Empty'}
    
    Available Options:
    - Meal Types: ${MEAL_OPTIONS.join(', ')}
    - Cuisines: ${CUISINE_OPTIONS.join(', ')}
    - Tags: ${TAG_OPTIONS.join(', ')}
    - Key Ingredients: ${INGREDIENT_OPTIONS.join(', ')}
    
    RULES:
    1. Only suggest values for MISSING fields
    2. If current data exists, keep it unchanged
    3. Choose from EXACT options provided
    4. Suggest standardized title if current title needs improvement
    
    Respond with ONLY valid JSON:
    {
      "standardized_title": "Clean recipe name (or null if current is good)",
      "meal": "exact meal type from options (or null if already set)",
      "cuisine": "exact cuisine from options (or null if already set)", 
      "tags": ["array", "of", "exact", "tags"] (or null if already set),
      "key_ingredients": ["array", "of", "exact", "ingredients"] (or null if already set),
      "confidence": 0.95,
      "reasoning": "Brief explanation of suggestions"
    }
    `;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    let aiContent = data.choices[0].message.content.trim();
    
    // Clean up response
    if (aiContent.startsWith('```json')) {
      aiContent = aiContent.slice(7);
    }
    if (aiContent.endsWith('```')) {
      aiContent = aiContent.slice(0, -3);
    }

    const analysis = JSON.parse(aiContent);
    
    console.log(`    ✅ AI Analysis complete (confidence: ${Math.round(analysis.confidence * 100)}%)`);
    console.log(`    💭 Reasoning: ${analysis.reasoning}`);
    
    return analysis;

  } catch (error) {
    console.log(`    ❌ AI analysis failed: ${error.message}`);
    return {
      confidence: 0,
      reasoning: `Analysis failed: ${error.message}`,
      standardized_title: null,
      meal: null,
      cuisine: null,
      tags: null,
      key_ingredients: null
    };
  }
}

async function testEnrichment() {
  try {
    // Initialize Notion client
    const notion = new Client({ auth: NOTION_TOKEN });
    
    console.log('1️⃣ Getting recipes that need enrichment...');
    
    // Get incomplete recipes
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        or: [
          { property: "Meal", select: { is_empty: true } },
          { property: "Cuisine", select: { is_empty: true } },
          { property: "Key Ingredients", multi_select: { is_empty: true } },
          { property: "Tags", multi_select: { is_empty: true } }
        ]
      },
      page_size: 3 // Test with just 3 recipes
    });

    const recipes = response.results.map(page => ({
      id: page.id,
      url: page.url,
      name: page.properties.Name?.title?.[0]?.plain_text || '',
      link: page.properties.Link?.url || '',
      current_meal: page.properties.Meal?.select?.name,
      current_cuisine: page.properties.Cuisine?.select?.name,
      current_tags: page.properties.Tags?.multi_select?.map(tag => tag.name) || [],
      current_ingredients: page.properties['Key Ingredients']?.multi_select?.map(ing => ing.name) || []
    }));

    console.log(`✅ Found ${recipes.length} recipes to test\n`);
    
    if (recipes.length === 0) {
      console.log('🎉 No recipes need enrichment!');
      return;
    }

    // Process each recipe
    for (let i = 0; i < recipes.length; i++) {
      const recipe = recipes[i];
      console.log(`\n2️⃣ Processing recipe ${i + 1}/${recipes.length}: ${recipe.name}`);
      
      // Extract data from source URL
      const extractedData = await extractRecipeFromURL(recipe.link);
      
      // Analyze with AI
      const analysis = await analyzeRecipeWithAI(recipe, extractedData);
      
      // Display results
      console.log('\n📊 ENRICHMENT RESULTS:');
      console.log('─'.repeat(50));
      console.log(`Recipe: ${recipe.name}`);
      console.log(`Confidence: ${Math.round(analysis.confidence * 100)}%`);
      console.log(`Reasoning: ${analysis.reasoning}`);
      
      if (analysis.standardized_title) {
        console.log(`🏷️  Title suggestion: ${analysis.standardized_title}`);
      }
      if (analysis.meal) {
        console.log(`🍽️  Meal type: ${analysis.meal}`);
      }
      if (analysis.cuisine) {
        console.log(`🌍 Cuisine: ${analysis.cuisine}`);
      }
      if (analysis.tags?.length > 0) {
        console.log(`🏷️  Tags: ${analysis.tags.join(', ')}`);
      }
      if (analysis.key_ingredients?.length > 0) {
        console.log(`🥕 Key ingredients: ${analysis.key_ingredients.join(', ')}`);
      }
      
      console.log('─'.repeat(50));
      
      // Small delay to be nice to APIs
      if (i < recipes.length - 1) {
        console.log('⏳ Waiting 2 seconds before next recipe...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('\n🎉 Local enrichment test completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('1. Add environment variables to Vercel dashboard');
    console.log('2. Test the web interface');
    console.log('3. Use the dashboard to apply these suggestions to your Notion database');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('\nFull error:', error.stack);
  }
}

// Run the test
testEnrichment();