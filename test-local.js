// Local test script for Notion connection
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = "1b1ea313dfba4618915c4574ad7ed576";

console.log('🔍 Testing Notion connection locally...\n');

// Check environment variables
console.log('Environment check:');
console.log('- NOTION_TOKEN:', NOTION_TOKEN ? '✅ Present' : '❌ Missing');
console.log('- DATABASE_ID:', DATABASE_ID);
console.log('- EMAIL_USER:', process.env.EMAIL_USER ? '✅ Present' : '❌ Missing');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Present' : '❌ Missing');
console.log('');

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN is missing from .env file');
  process.exit(1);
}

try {
  // Initialize Notion client
  const notion = new Client({ auth: NOTION_TOKEN });
  
  console.log('🔌 Connecting to Notion database...');
  
  // Test basic connection with simple query
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    page_size: 5 // Just get 5 recipes for testing
  });

  console.log('✅ Connection successful!\n');
  console.log(`📊 Found ${response.results.length} recipes in database`);
  
  if (response.results.length > 0) {
    console.log('\n📝 Sample recipes:');
    response.results.forEach((page, index) => {
      const name = page.properties.Name?.title?.[0]?.plain_text || 'Untitled';
      const link = page.properties.Link?.url || 'No link';
      const meal = page.properties.Meal?.select?.name || 'Not set';
      const cuisine = page.properties.Cuisine?.select?.name || 'Not set';
      const tags = page.properties.Tags?.multi_select?.map(tag => tag.name) || [];
      const ingredients = page.properties['Key Ingredients']?.multi_select?.map(ing => ing.name) || [];
      
      console.log(`\n${index + 1}. ${name}`);
      console.log(`   Link: ${link}`);
      console.log(`   Meal: ${meal}`);
      console.log(`   Cuisine: ${cuisine}`);
      console.log(`   Tags: ${tags.join(', ') || 'None'}`);
      console.log(`   Ingredients: ${ingredients.join(', ') || 'None'}`);
    });
  }
  
  // Test for incomplete recipes
  console.log('\n🔍 Checking for recipes that need enrichment...');
  
  const incompleteResponse = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      or: [
        { property: "Meal", select: { is_empty: true } },
        { property: "Cuisine", select: { is_empty: true } },
        { property: "Key Ingredients", multi_select: { is_empty: true } },
        { property: "Tags", multi_select: { is_empty: true } }
      ]
    },
    page_size: 10
  });
  
  console.log(`🎯 Found ${incompleteResponse.results.length} recipes that need enrichment`);
  
  if (incompleteResponse.results.length > 0) {
    console.log('\n📋 Recipes needing enrichment:');
    incompleteResponse.results.slice(0, 3).forEach((page, index) => {
      const name = page.properties.Name?.title?.[0]?.plain_text || 'Untitled';
      const meal = page.properties.Meal?.select?.name;
      const cuisine = page.properties.Cuisine?.select?.name;
      const tags = page.properties.Tags?.multi_select?.length || 0;
      const ingredients = page.properties['Key Ingredients']?.multi_select?.length || 0;
      
      console.log(`\n${index + 1}. ${name}`);
      console.log(`   Missing: ${!meal ? 'Meal ' : ''}${!cuisine ? 'Cuisine ' : ''}${tags === 0 ? 'Tags ' : ''}${ingredients === 0 ? 'Ingredients' : ''}`);
    });
  }
  
  console.log('\n🎉 Notion connection test completed successfully!');

} catch (error) {
  console.error('\n❌ Notion connection failed:');
  console.error('Error:', error.message);
  
  if (error.code === 'unauthorized') {
    console.error('\n💡 This usually means:');
    console.error('1. Invalid NOTION_TOKEN');
    console.error('2. The integration hasn\'t been shared with the database');
    console.error('3. The token has expired');
  } else if (error.code === 'object_not_found') {
    console.error('\n💡 This usually means:');
    console.error('1. Wrong DATABASE_ID');
    console.error('2. Database was deleted or moved');
    console.error('3. Integration doesn\'t have access to this database');
  }
  
  console.error('\nFull error details:', error);
  process.exit(1);
}