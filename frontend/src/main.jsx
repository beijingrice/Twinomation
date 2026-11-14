import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PassengerApp from './Passenger';
import './styles.css';

createRoot(document.getElementById('root')).render(window.location.pathname.startsWith('/passenger') ? <PassengerApp/> : <App/>);
