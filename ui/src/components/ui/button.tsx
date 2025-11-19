import * as React from "react";

import { cn } from "@/lib/utils";

import { type VariantProps, cva } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-0 focus:ring-purple-400 focus:ring-offset-0 disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default:
          "bg-purple-600 text-white hover:bg-purple-700 border border-purple-500",
        destructive:
          "bg-red-600 text-white hover:bg-red-700 border border-red-500",
        success:
          "bg-purple-600 text-white hover:bg-purple-700 border border-purple-500",
        outline:
          "bg-transparent border border-purple-500 text-purple-400 hover:bg-purple-900/20 hover:text-purple-400",
        subtle:
          "bg-gray-800 text-gray-200 hover:bg-gray-700 border border-gray-700",
        ghost:
          "bg-transparent hover:bg-gray-800 text-gray-300 hover:text-gray-100",
        link: "bg-transparent underline-offset-4 hover:underline text-purple-400 hover:text-purple-300",
      },
      size: {
        default: "h-10 py-2 px-4",
        sm: "h-9 px-2 rounded-md",
        lg: "h-11 px-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
