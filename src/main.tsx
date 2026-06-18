
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/globals.css";
  import { Amplify } from "aws-amplify";

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: "us-west-2_xizwAfENt",
        userPoolClientId: "1i86742o31bsd4p9g5oetqj2k4",
      }
    }
  });

  createRoot(document.getElementById("root")!).render(<App />);
  