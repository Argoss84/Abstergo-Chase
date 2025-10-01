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
  bgColor = '#ffffff',
  fgColor = '#000000',
  includeMargin = true
}) => {
  return (
    <div className="qrcode-container">
      <QRCodeSVG
        value={value}
        size={size}
        level={level}
        bgColor={bgColor}
        fgColor={fgColor}
        includeMargin={includeMargin}
      />
    </div>
  );
};

export default QRCode;

