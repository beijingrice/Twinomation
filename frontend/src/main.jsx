import React,{lazy,Suspense} from 'react';
import { createRoot } from 'react-dom/client';
const App=lazy(()=>import('./App'));
const IndexPage=lazy(()=>import('./Index'));
const PassengerApp=lazy(()=>import('./Passenger'));
import { MODE } from './constants';
import './styles.css';
import {t} from './i18n';

const Root = MODE === 'passenger' ? PassengerApp : MODE === 'index' ? IndexPage : App;
createRoot(document.getElementById('root')).render(<Suspense fallback={<div className="loading">{t('Loading flight…')}</div>}><Root/></Suspense>);
