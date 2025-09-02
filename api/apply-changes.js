
// File: api/apply-changes.js (Enhanced version with better error handling)
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { recipeId, changes } = req.body;

    if (!recipeId) {
        return res.status(400).json({ error: 'Recipe ID is required' });
    }

    try {
        const properties = {};
        let imageAdded = false;

        // Build properties object for Notion update
        if (changes.title && changes.title.trim()) {
            properties.Name = {
                title: [{ text: { content: changes.title.trim() } }]
            };
        }

        if (changes.meal && changes.meal !== 'Not Set') {
            properties.Meal = { select: { name: changes.meal } };
        }

        if (changes.cuisine && changes.cuisine !== 'Not Set') {
            properties.Cuisine = { select: { name: changes.cuisine } };
        }

        if (changes.tags && Array.isArray(changes.tags) && changes.tags.length > 0) {
            properties.Tags = {
                multi_select: changes.tags
                    .filter(tag => tag.trim())
                    .map(tag => ({ name: tag.trim() }))
            };
        }

        if (changes.key_ingredients && Array.isArray(changes.key_ingredients) && changes.key_ingredients.length > 0) {
            properties['Key Ingredients'] = {
                multi_select: changes.key_ingredients
                    .filter(ing => ing.trim())
                    .map(ing => ({ name: ing.trim() }))
            };
        }

        // Update page properties
        if (Object.keys(properties).length > 0) {
            await notion.pages.update({
                page_id: recipeId,
                properties
            });
        }

        // Handle image separately if provided
        if (changes.image && changes.image.startsWith('http')) {
            try {
                // Remove existing image blocks first
                const blocks = await notion.blocks.children.list({
                    block_id: recipeId,
                    page_size: 20
                });
                
                for (const block of blocks.results) {
                    if (block.type === 'image') {
                        await notion.blocks.delete({
                            block_id: block.id
                        });
                    }
                }

                // Add new image
                await notion.blocks.children.append({
                    block_id: recipeId,
                    children: [{
                        type: 'image',
                        image: {
                            type: 'external',
                            external: { url: changes.image }
                        }
                    }]
                });
                
                imageAdded = true;
            } catch (imageError) {
                console.error('Image addition error:', imageError);
                // Continue without failing the entire operation
            }
        }

        return res.status(200).json({ 
            success: true,
            updated: Object.keys(properties),
            imageAdded,
            message: 'Changes applied successfully'
        });

    } catch (error) {
        console.error('Apply changes error:', error);
        
        // Provide more specific error messages
        let errorMessage = 'Failed to update recipe';
        
        if (error.code === 'object_not_found') {
            errorMessage = 'Recipe not found in Notion';
        } else if (error.code === 'validation_error') {
            errorMessage = 'Invalid data provided';
        } else if (error.message.includes('property')) {
            errorMessage = 'Property validation failed - check your database schema';
        }
        
        return res.status(500).json({ 
            success: false, 
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
