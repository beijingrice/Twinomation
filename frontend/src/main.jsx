import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import IndexPage from './Index';
import PassengerApp from './Passenger';
import { MODE } from './constants';
import './styles.css';

const Root = MODE === 'passenger' ? PassengerApp : MODE === 'index' ? IndexPage : App;
createRoot(document.getElementById('root')).render(<Root/>);
