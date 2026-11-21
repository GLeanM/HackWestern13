import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        // Access tokens are issued for the CartPilot API with these permissions.
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: "openid profile email read:profile write:profile",
      }}
    >
      <App />
    </Auth0Provider>
  </StrictMode>,
);
