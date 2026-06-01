import os
import uuid
import time
import json
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load env variables from .env
load_dotenv()

from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.session.agent import AgentSession
from db_init import init_products_db
# from langfuse.decorators import observe, langfuse_context
from langfuse import observe, propagate_attributes

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize products database
    try:
        init_products_db()
    except Exception as e:
        print(f"lifespan startup error: {e}")

    # Initialize Langfuse and OpenTelemetry instrumentation for Agno
    try:
        if os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"):
            from langfuse import get_client
            from openinference.instrumentation.agno import AgnoInstrumentor
            
            # Initialize global Langfuse client (registers OTel SpanProcessor)
            get_client()
            
            # Instrument Agno
            AgnoInstrumentor().instrument()
            print("Langfuse and Agno OpenTelemetry instrumentation initialized successfully.", flush=True)
        else:
            print("Langfuse keys not configured. Observability tracing is disabled.", flush=True)
    except Exception as e:
        print(f"Failed to initialize Langfuse/Agno telemetry: {e}", flush=True)
    yield


app = FastAPI(title="ChatWithTej Backend", lifespan=lifespan)


# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize SqliteDb in the configured directory (supports Docker volume persistence)
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "chats.db"))
db = SqliteDb(db_file=DB_PATH)

class CreateSessionRequest(BaseModel):
    name: Optional[str] = "New Chat"

class RenameSessionRequest(BaseModel):
    name: str

class ChatRequest(BaseModel):
    message: str
    session_id: str
    model_id: Optional[str] = "gemini-2.5-flash"
    enable_search: Optional[bool] = False
    system_instruction: Optional[str] = None
    user_api_key: Optional[str] = None


@app.get("/api/sessions")
async def list_sessions():
    """List all agent chat sessions sorted by updated_at desc"""
    try:
        sessions = db.get_sessions()
        result = []
        if sessions:
            # Sort sessions in reverse order (newest first)
            sorted_sessions = sorted(sessions, key=lambda s: getattr(s, "updated_at", 0), reverse=True)
            for s in sorted_sessions:
                session_name = s.session_data.get("session_name") if s.session_data else None
                if not session_name:
                    session_name = f"Chat {s.session_id[:8]}"
                result.append({
                    "session_id": s.session_id,
                    "session_name": session_name,
                    "created_at": getattr(s, "created_at", 0),
                    "updated_at": getattr(s, "updated_at", 0),
                    "model": s.agent_data.get("model", {}).get("id", "Unknown") if s.agent_data else "Unknown"
                })
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list sessions: {str(e)}")


@app.post("/api/sessions")
async def create_session(request: CreateSessionRequest):
    """Create a new chat session in the DB"""
    try:
        session_id = str(uuid.uuid4())
        now_ts = int(time.time())
        session = AgentSession(
            session_id=session_id,
            session_data={"session_name": request.name},
            created_at=now_ts,
            updated_at=now_ts
        )
        db.upsert_session(session)
        return {
            "session_id": session_id,
            "session_name": request.name,
            "created_at": now_ts,
            "updated_at": now_ts
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")


@app.post("/api/sessions/{session_id}/rename")
async def rename_session(session_id: str, request: RenameSessionRequest):
    """Rename a session in the DB"""
    try:
        # Check if session exists
        s = db.get_session(session_id)
        if not s:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Rename using Agno db rename method
        db.rename_session(session_id=session_id, session_type=None, session_name=request.name)
        return {"session_id": session_id, "session_name": request.name}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename session: {str(e)}")


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session from the DB"""
    try:
        s = db.get_session(session_id)
        if not s:
            raise HTTPException(status_code=404, detail="Session not found")
        
        db.delete_session(session_id)
        return {"status": "success", "message": f"Session {session_id} deleted"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {str(e)}")


@app.get("/api/sessions/{session_id}/history")
async def get_session_history(session_id: str):
    """Fetch the chat message history for a specific session"""
    try:
        s = db.get_session(session_id)
        if not s:
            raise HTTPException(status_code=404, detail="Session not found")
        
        messages = []
        if s.runs:
            for run in s.runs:
                # Add user message
                user_content = getattr(run.input, "input_content", "") if run.input else ""
                messages.append({
                    "role": "user",
                    "content": user_content,
                    "created_at": getattr(run, "created_at", 0)
                })
                # Add assistant message
                messages.append({
                    "role": "assistant",
                    "content": run.content,
                    "created_at": getattr(run, "created_at", 0),
                    "status": getattr(run, "status", "SUCCESS")
                })
        return messages
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get history: {str(e)}")


def query_products_database(query: str) -> str:
    """
    Execute a read-only PostgreSQL SELECT query on the products database.
    Use this tool to find information about products, categories, brands, prices, stock, ratings, and descriptions.
    
    Args:
        query (str): The SELECT query to run (e.g. "SELECT * FROM products;").
        
    Returns:
        str: JSON string of matching products or error.
    """
    import psycopg2
    from psycopg2.extras import RealDictCursor
    
    clean_query = query.strip()
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Executing SQL query: {clean_query}", flush=True)
    if not clean_query.upper().startswith("SELECT"):
        return json.dumps({"error": "Only SELECT queries are allowed."})
        
    conn = None
    try:
        conn = psycopg2.connect(
            host=os.environ.get("POSTGRES_HOST", "localhost"),
            port=os.environ.get("POSTGRES_PORT", "5432"),
            database=os.environ.get("POSTGRES_DB", "tej_products"),
            user=os.environ.get("POSTGRES_USER", "tej_user"),
            password=os.environ.get("POSTGRES_PASSWORD", "tej_password")
        )
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(clean_query)
            results = cur.fetchall()
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Query returned {len(results)} rows: {results}", flush=True)
            return json.dumps(results, default=str)
    except Exception as e:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Query error: {e}", flush=True)
        return json.dumps({"error": str(e)})
    finally:
        if conn:
            conn.close()


@observe(name="chat-response")
def generate_agent_stream(
    message: str,
    session_id: str,
    model_id: str,
    enable_search: bool,
    system_instruction: Optional[str],
    user_api_key: Optional[str]
):
    try:
        propagate_attributes(
            session_id=session_id,
            metadata={
                "model_id": str(model_id),
                "enable_search": str(enable_search)
            }
        )
    except Exception as e:
        print(f"Failed to update Langfuse trace: {e}", flush=True)

    api_key = user_api_key or os.getenv("GEMINI_API_KEY")
    if not api_key:
        yield f"data: {json.dumps({'type': 'error', 'content': 'API Key not configured. Please enter your Gemini API Key in the settings.'})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    # Set env vars temporarily
    original_gemini_key = os.environ.get("GEMINI_API_KEY")
    original_google_key = os.environ.get("GOOGLE_API_KEY")
    os.environ["GEMINI_API_KEY"] = api_key
    os.environ["GOOGLE_API_KEY"] = api_key

    try:
        from agno.models.google import Gemini
        
        tools = [query_products_database]
        if enable_search:
            from agno.tools.duckduckgo import DuckDuckGoTools
            tools.append(DuckDuckGoTools())

        base_instructions = [
            "You are a helpful assistant with access to a PostgreSQL database containing product details.",
            "You can query the database using the `query_products_database` tool.",
            "The database contains a table named `products` with the following schema:",
            "- `id` (SERIAL PRIMARY KEY)",
            "- `name` (VARCHAR(255) NOT NULL) - e.g., 'MacBook Air M2', 'iPhone 15'",
            "- `category` (VARCHAR(100) NOT NULL) - e.g., 'Laptop', 'Mobile', 'Headphones', 'Accessories', 'Tablet', 'Smart Home'",
            "- `brand` (VARCHAR(100) NOT NULL) - e.g., 'Apple', 'Dell', 'Samsung', 'Sony', 'Logitech', 'ASUS', 'Boat', 'OnePlus', 'HP', 'Amazon'",
            "- `price` (INT NOT NULL) - price in Indian Rupees (₹)",
            "- `stock` (INT NOT NULL) - number of items in stock",
            "- `rating` (DECIMAL(3, 2) NOT NULL) - user rating out of 5.0",
            "- `description` (TEXT NOT NULL) - product description containing key features (e.g., 'noise cancelling', 'gaming', 'M2 chip')",
            "",
            "When answering questions related to products, stock, ratings, or prices, always query the database first.",
            "If the user asks questions like:",
            "1. 'Which laptop is best for gaming?' -> Query laptops and check their descriptions for 'gaming' or check ratings.",
            "2. 'Show products under ₹10,000' -> Query products where price < 10000.",
            "3. 'Which products are out of stock?' -> Query products where stock = 0. If none, state that none are out of stock.",
            "4. 'What is the highest rated phone?' -> Query category = 'Mobile' ordered by rating descending limit 1.",
            "5. 'Compare Apple products' -> Query products where brand = 'Apple'.",
            "6. 'Which headphones have noise cancellation?' -> Query headphones and check descriptions for 'noise cancellation' or 'noise cancelling'.",
            "Present findings in a neat, professional markdown format, highlighting specifications like price (formatted in ₹), rating, and stock status."
        ]
        if system_instruction:
            base_instructions.append(system_instruction)

        agent = Agent(
            model=Gemini(id=model_id),
            db=db,
            add_history_to_context=True,
            instructions=base_instructions,
            tools=tools,
        )

        response_stream = agent.run(message, session_id=session_id, stream=True)
        
        for event in response_stream:
            event_type = type(event).__name__
            
            if event_type == "RunContentEvent":
                yield f"data: {json.dumps({'type': 'content', 'content': event.content})}\n\n"
            
            elif event_type == "ToolCallStartedEvent":
                tool_name = getattr(event.tool, "tool_name", "Web Search")
                yield f"data: {json.dumps({'type': 'tool_start', 'content': tool_name})}\n\n"
            
            elif event_type == "ToolCallCompletedEvent":
                tool_name = getattr(event.tool, "tool_name", "Web Search")
                yield f"data: {json.dumps({'type': 'tool_end', 'content': tool_name})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        
    finally:
        # Restore original keys
        if original_gemini_key is not None:
            os.environ["GEMINI_API_KEY"] = original_gemini_key
        else:
            os.environ.pop("GEMINI_API_KEY", None)

        if original_google_key is not None:
            os.environ["GOOGLE_API_KEY"] = original_google_key
        else:
            os.environ.pop("GOOGLE_API_KEY", None)


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Send a message to the agent and stream the SSE response"""
    return StreamingResponse(
        generate_agent_stream(
            message=request.message,
            session_id=request.session_id,
            model_id=request.model_id,
            enable_search=request.enable_search,
            system_instruction=request.system_instruction,
            user_api_key=request.user_api_key
        ),
        media_type="text/event-stream"
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=port, reload=True)
