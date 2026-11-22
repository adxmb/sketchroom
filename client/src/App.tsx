import { Link, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";
import { useSession } from "./useSession";

export function App() {
    const session = useSession();
    return (
        <main className="wrap">
            <Routes>
                <Route path="/" element={<Home session={session} />} />
                <Route
                    path="/r/:code"
                    element={<RoomPage session={session} />}
                />
                <Route
                    path="*"
                    element={
                        <section className="card">
                            <h2>Page not found</h2>
                            <Link to="/">Back to start</Link>
                        </section>
                    }
                />
            </Routes>
        </main>
    );
}
