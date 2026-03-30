"""LLM configuration, system prompt, and tool definitions."""

LLM_CONFIG = {
    "model": "gpt-4o-mini",
    "temperature": 0.1,  # Slightly more natural while still fast
    "max_tokens": 100,   # Allow complete sentences but keep concise
}

GREETING = "Hi! You're speaking with our virtual pharmacy assistant. How may I assist you today?"

GOODBYE_PHRASES = [
    "goodbye",
    "bye", 
    "take care",
    "have a great day",
    "thank you for calling",
]

PHARMACY_SYSTEM_PROMPT = """You are a pharmacy assistant. Be concise but conversational.

CRITICAL RULES:
1. Call functions for data. Never guess.
2. Spell IDs: "O R D 0 0 1"
3. ONLY answer what was asked. NEVER add extra info.
4. ONLY call the minimum functions needed. STOP after getting the answer.
5. After answering, vary your follow-up naturally. Never repeat the same one twice in a row. Options:
   "Anything else?" / "What else can I help with?" / "Need anything else?" / "Is there anything else?" / Or just end naturally with no question.

IMPORTANT - FUNCTION CALL LIMITS:
- "order status" → call verify_member_id + list_member_orders ONLY. Do NOT call lookup_order_status or get_order_details.
- "what's in it" → call get_order_details ONLY.
- "when ready" → call get_order_timing ONLY.
- "refills" → call get_order_refills ONLY.
- NEVER chain more than 2 function calls.

RESPONSE EXAMPLES:
- Status: "You have 1 order: O R D 0 0 1, currently processing."
- Details: "Your order contains Amoxicillin 500mg, 21 pills."
- Timing: "Your order should be ready for pickup on March 25th at 10 AM."
- Refills: "You have 0 refills remaining for your prescription."
- Not found: "I couldn't find that member ID. Could you verify it?"
- Closing: "Thank you for calling. You can disconnect anytime."

NEVER volunteer medication details, timing, or refill info unless specifically asked."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "verify_member_id",
            "description": "Verify if a member ID exists in the system",
            "parameters": {
                "type": "object",
                "properties": {
                    "member_id": {"type": "string", "description": "The member ID to verify"},
                },
                "required": ["member_id"],
            },
        },
    },
    # end_session removed — never auto-disconnect
    {
        "type": "function", 
        "function": {
            "name": "list_member_orders",
            "description": "List all orders for a verified member",
            "parameters": {
                "type": "object",
                "properties": {
                    "member_id": {"type": "string", "description": "The verified member ID"},
                },
                "required": ["member_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_order_details",
            "description": "Get medication details for an order",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "The order ID"},
                    "member_id": {"type": "string", "description": "The verified member ID"},
                },
                "required": ["order_id", "member_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_order_timing",
            "description": "Get timing information for an order",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "The order ID"},
                    "member_id": {"type": "string", "description": "The verified member ID"},
                },
                "required": ["order_id", "member_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_order_refills",
            "description": "Get refill information for an order",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "The order ID"},
                    "member_id": {"type": "string", "description": "The verified member ID"},
                },
                "required": ["order_id", "member_id"],
            },
        },
    },
    # lookup_order_status removed — causes unnecessary chained calls and verbose responses
]