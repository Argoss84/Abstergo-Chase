import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import './QRCode.css';

interface QRCodeProps {
  value: string;
  size?: number;
  level?: 'L' | 'M' | 'Q' | 'H';
  bgColor?: string;
  fgColor?: string;
  includeMargin?: boolean;
}

const QRCode: React.FC<QRCodeProps> = ({ 
  value, 
  size = 256,
  level = 'M',
  bgColor = '#0a0a0a',
  fgColor = '#00ff41',
  includeMargin = true
}) => {
  return (
    <div className="qrcode-container">
      <div className="qrcode-frame">
        <div className="qrcode-scanlines" />
        <QRCodeSVG
          value={value}
          size={size}
          level={level}
          bgColor={bgColor}
          fgColor={fgColor}
          includeMargin={includeMargin}
        />
      </div>
    </div>
  );
};

export default QRCode;

